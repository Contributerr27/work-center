// Setup and Settings: finds the AI tools on this machine, what they are connected to and the rules
// written for them, connects amem, and works out who the person is (name, role, company, GitHub,
// Jira, Slack…) so Work Center works for anyone, not one person or company.
//   GET  /api/setup               everything the Settings page shows (?force re-checks)
//   POST /api/settings            { patch } → saved to ~/.daily-hq/settings.json
//   POST /api/setup/run           "Set me up": tools → amem → profile (AI) → done
//   POST /api/setup/mcp-add       { name, from, to } copy one MCP server from one tool to another
//   POST /api/setup/amem          { action: 'install' | 'connect', tool }
const fs = require('node:fs');
const path = require('node:path');
const { detect, which, sh, home, appSupport, readJson } = require('../detect');

// Settings the page may change. Anything else in the file is left alone.
const EDITABLE = ['owner', 'github', 'jira', 'ai', 'workDir', 'terminalCwd', 'prd', 'slackScan', 'mailScan'];
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Where each tool keeps its MCP list, for copying a server into it. Claude goes through its CLI.
const MCP_TARGETS = {
  cursor: () => ({ file: home('.cursor', 'mcp.json'), key: 'mcpServers' }),
  gemini: () => ({ file: home('.gemini', 'settings.json'), key: 'mcpServers' }),
  windsurf: () => ({ file: home('.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers' }),
  'claude-desktop': () => ({ file: appSupport('Claude', 'claude_desktop_config.json'), key: 'mcpServers' }),
  copilot: () => ({ file: home('.copilot', 'mcp-config.json'), key: 'mcpServers' }),
  claude: () => ({ file: home('.claude.json'), key: 'mcpServers', cli: true }),
};

function setup(ctx) {
  const { config, settings } = ctx;
  const STATE = path.join(ctx.DATA, 'setup.json');
  const readSt = () => readJson(STATE) || {};
  const writeSt = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
  let cache = null;
  let job = readSt().job || null;
  if (job?.running) job = { ...job, running: false, error: 'Interrupted (the app restarted)' };

  async function scan(force) {
    if (!force && cache && Date.now() - new Date(cache.checkedAt) < 60_000) return cache;
    cache = await detect({ dataDir: ctx.DATA, engineId: ctx.engine()?.tool, force });
    return cache;
  }

  // Full server definition (with env) read straight from the source tool's file, never from the page.
  function rawServer(toolId, name) {
    if (toolId === 'codex') return null;
    const t = cache?.tools.find((x) => x.id === toolId);
    if (!t?.mcpFile) return null;
    const j = readJson(t.mcpFile) || {};
    const list = toolId === 'vscode' ? j.servers : toolId === 'opencode' ? j.mcp : j.mcpServers;
    return list?.[name] || null;
  }

  async function addServer(to, name, def) {
    const target = MCP_TARGETS[to]?.();
    if (!target) throw bad(`Work Center cannot add servers to ${to} yet`);
    if (!/^[\w.@-]{1,64}$/.test(name)) throw bad('Bad server name');
    const clean = { ...def };
    delete clean.disabled;
    if (target.cli) {
      if (!which('claude')) throw bad('Claude Code is not installed');
      const r = await sh('claude', ['mcp', 'add-json', '-s', 'user', name, JSON.stringify(clean)], 30_000);
      if (!r.ok) throw bad((r.err || r.out).trim().split('\n').pop().slice(0, 200) || 'claude mcp add-json failed', 500);
      return { added: true, to, name };
    }
    const j = readJson(target.file) || {};
    if (j[target.key]?.[name]) return { added: false, already: true, to, name };
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    if (fs.existsSync(target.file)) fs.copyFileSync(target.file, `${target.file}.bak-dailyhq`);
    j[target.key] = { ...(j[target.key] || {}), [name]: clean };
    fs.writeFileSync(target.file, JSON.stringify(j, null, 2));
    return { added: true, to, name, backup: fs.existsSync(`${target.file}.bak-dailyhq`) ? `${target.file}.bak-dailyhq` : null };
  }

  const amemDef = () => ({ command: which('amem'), args: ['mcp'], env: {} });
  async function installAmem() {
    if (which('amem')) return { installed: true, already: true };
    if (!which('npm')) throw bad('amem needs Node.js (npm). Install Node from nodejs.org, then try again.');
    const r = await sh('npm', ['install', '-g', '@iamem/amem'], 5 * 60_000);
    if (!which('amem')) throw bad(`npm could not install amem: ${(r.err || r.out).trim().split('\n').pop().slice(0, 200)}`, 500);
    await sh('amem', ['setup', '--personal'], 60_000); // creates the personal memory store
    return { installed: true };
  }

  // Facts that need no AI: the Claude account, git identity, gh login.
  async function quickFacts() {
    const facts = {};
    const acct = readJson(home('.claude.json'))?.oauthAccount;
    if (acct?.emailAddress) Object.assign(facts, { email: acct.emailAddress, name: acct.displayName || acct.fullName, company: acct.organizationName });
    const gname = (await sh('git', ['config', '--global', 'user.name'])).out.trim();
    const gmail = (await sh('git', ['config', '--global', 'user.email'])).out.trim();
    facts.name ||= gname || undefined;
    facts.email ||= gmail || undefined;
    if (which('gh')) {
      const u = await sh('gh', ['api', 'user', '--jq', '.login + "\\t" + (.name // "") + "\\t" + (.company // "")'], 15_000);
      const [login, name, company] = u.out.trim().split('\t');
      if (login) Object.assign(facts, { githubLogin: login, name: facts.name || name || undefined, company: facts.company || company?.replace(/^@/, '') || undefined });
    }
    return facts;
  }

  // Only fills what is empty: never overwrites what the person typed.
  function fillBlanks(p) {
    const cur = config;
    const patch = { owner: {}, github: {}, jira: {} };
    const set = (sec, k, v) => { if (v !== undefined && v !== null && v !== '' && !(cur[sec] || {})[k] && !(Array.isArray(v) && !v.length)) patch[sec][k] = v; };
    const o = p.owner || {};
    for (const k of ['name', 'email', 'role', 'company', 'slackId', 'slackTeamId', 'slackDomain']) set('owner', k, o[k]);
    const g = p.github || {};
    set('github', 'login', g.login); set('github', 'repo', g.repo); set('github', 'orgs', g.orgs);
    const ji = p.jira || {};
    set('jira', 'site', ji.site);
    const out = {};
    for (const [k, v] of Object.entries(patch)) if (Object.keys(v).length) out[k] = v;
    if (p.workDir && !cur.workDir && !cur.jira?.qaWorkDir && fs.existsSync(ctx.expand(p.workDir))) out.workDir = p.workDir;
    if (Object.keys(out).length) settings.save(out);
    return out;
  }

  function step(id, status, note) {
    const s = job.steps.find((x) => x.id === id);
    Object.assign(s, { status, note: note ?? s.note });
    writeSt({ ...readSt(), job });
  }

  async function runSetup() {
    if (job?.running) return job;
    job = {
      running: true, startedAt: new Date().toISOString(), error: null,
      steps: [
        { id: 'tools', label: 'Find your AI tools and connections', status: 'pending' },
        { id: 'amem', label: 'Connect memory (amem)', status: 'pending' },
        { id: 'facts', label: 'Read your accounts (Claude, git, GitHub)', status: 'pending' },
        { id: 'profile', label: 'Work out your role, team and tools with AI', status: 'pending' },
      ],
    };
    writeSt({ ...readSt(), job });
    (async () => {
      try {
        step('tools', 'running');
        const d = await scan(true);
        const found = d.tools.filter((t) => t.present);
        step('tools', 'done', `${found.length} tools, ${d.mcp.length} connections, ${d.instructions.length} rule files`);
        if (!d.engine) throw new Error('No AI CLI that can do the work: install Claude Code (or Cursor, Gemini CLI, Codex), sign in, then run setup again.');

        step('amem', 'running');
        try {
          const had = which('amem');
          await installAmem();
          const eng = d.engine.id;
          const missing = !(readJson(home('.claude.json'))?.mcpServers?.amem) && eng === 'claude';
          const otherMissing = eng !== 'claude' && !d.tools.find((t) => t.id === eng)?.mcp.some((m) => m.name === 'amem');
          if ((missing || otherMissing) && MCP_TARGETS[eng]) await addServer(eng, 'amem', amemDef());
          step('amem', 'done', `${had ? 'Found' : 'Installed'}${missing || otherMissing ? `, connected to ${d.engine.name}` : `, already connected to ${d.engine.name}`}`);
        } catch (e) { step('amem', 'failed', e.message); }

        step('facts', 'running');
        const f = await quickFacts();
        const filled = fillBlanks({ owner: { name: f.name, email: f.email, company: f.company }, github: { login: f.githubLogin } });
        step('facts', 'done', [f.name, f.email, f.githubLogin && `GitHub ${f.githubLogin}`].filter(Boolean).join(' · ') || 'nothing found');

        step('profile', 'running', `${d.engine.name} is checking your connected apps (a few minutes)`);
        const prompt = ctx.fillPrompt(fs.readFileSync(path.join(ctx.ROOT, 'prompts', 'setup.md'), 'utf8'), {
          KNOWN: JSON.stringify({ owner: config.owner, github: config.github, jira: { site: config.jira?.site } }),
          CONNECTIONS: d.mcp.filter((m) => m.tools.includes(d.engine.id) && m.status !== 'failed' && m.status !== 'needs-auth').map((m) => m.name).join(', ') || 'none',
        });
        const r = await ctx.ai(prompt, { cwd: ctx.DATA, timeoutMs: 15 * 60_000 });
        if (r.error) throw new Error(r.error);
        const t = r.text || '';
        const p = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
        const more = fillBlanks(p);
        writeSt({ ...readSt(), proposal: { ...p, at: new Date().toISOString() } });
        const n = Object.values({ ...filled, ...more }).reduce((a, v) => a + (typeof v === 'object' ? Object.keys(v).length : 1), 0);
        step('profile', 'done', `${n} settings filled in${p.notes ? ` · ${String(p.notes).slice(0, 140)}` : ''}`);
        settings.save({ setupDoneAt: new Date().toISOString() });
        job = { ...job, running: false, finishedAt: new Date().toISOString() };
      } catch (e) {
        const cur = job.steps.find((s) => s.status === 'running');
        if (cur) cur.status = 'failed', cur.note = e.message.slice(0, 200);
        job = { ...job, running: false, error: e.message.slice(0, 300), finishedAt: new Date().toISOString() };
      }
      writeSt({ ...readSt(), job });
      ctx.logRun({ kind: 'setup', title: 'Work Center setup', startedAt: job.startedAt, finishedAt: job.finishedAt, result: job.error ? null : job.steps.map((x) => `${x.label}: ${x.note || x.status}`).join('\n'), error: job.error });
      cache = null;
    })();
    return job;
  }

  ctx.route('GET', '/api/setup', async ({ url }) => {
    const d = await scan(url.searchParams.has('force'));
    const st = readSt();
    const e = ctx.engine();
    const s = {};
    for (const k of EDITABLE) if (config[k] !== undefined) s[k] = config[k];
    return {
      ...d, job, proposal: st.proposal || null,
      settings: s, settingsFile: settings.FILE, dataDir: ctx.DATA, setupDoneAt: config.setupDoneAt || null,
      engineNow: e ? { id: e.id, tool: e.tool, name: e.name, small: e.small, model: e.model } : null,
      engines: ['claude', 'cursor', 'gemini', 'codex'].map((id) => ({ id, available: !!which({ claude: 'claude', cursor: 'cursor-agent', gemini: 'gemini', codex: 'codex' }[id]) })),
      targets: Object.keys(MCP_TARGETS),
    };
  });

  ctx.route('POST', '/api/settings', ({ body }) => {
    const patch = body?.patch;
    if (!patch || typeof patch !== 'object') throw bad('Nothing to save');
    const clean = {};
    for (const k of Object.keys(patch)) if (EDITABLE.includes(k)) clean[k] = patch[k];
    if (!Object.keys(clean).length) throw bad('Nothing to save');
    // Instruction files can only be shared from the list Settings found.
    const share = clean.ai?.shareInstructions;
    if (share !== undefined) {
      const known = new Set((cache?.instructions || []).map((i) => i.path));
      if (!Array.isArray(share) || share.some((f) => !known.has(f))) throw bad('Unknown instruction file');
    }
    settings.save(clean);
    cache = null;
    return { saved: true };
  });

  ctx.route('POST', '/api/setup/run', () => runSetup());

  ctx.route('POST', '/api/setup/mcp-add', async ({ body }) => {
    const { name, from, to } = body || {};
    await scan(false);
    const def = rawServer(from, name);
    if (!def) throw bad(`${name} was not found in ${from}`);
    const r = await addServer(to, name, def);
    cache = null;
    return r;
  });

  ctx.route('POST', '/api/setup/amem', async ({ body }) => {
    const { action, tool } = body || {};
    if (action === 'install') { const r = await installAmem(); cache = null; return r; }
    if (action === 'connect') {
      if (!which('amem')) throw bad('Install amem first');
      const r = await addServer(tool, 'amem', amemDef());
      cache = null;
      return r;
    }
    throw bad('Bad action');
  });

  ctx.provide('setup', () => ({ done: !!config.setupDoneAt, running: !!job?.running }));
  // Warm the connection check so Settings opens with fresh data.
  setTimeout(() => scan(false).catch(() => {}), 3000).unref?.();
}

module.exports = { setup };
