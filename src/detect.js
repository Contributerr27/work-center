// Finds the AI tools on this machine (Claude, Cursor, Gemini, Codex/ChatGPT, Windsurf, Copilot,
// VS Code, Ollama, Aider, opencode…), what each one is connected to (MCP servers), the rules and
// instruction files the person already wrote for them, and amem. Read-only: nothing here writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { env } = require('./collect');

const HOMEDIR = os.homedir();
const home = (...p) => path.join(HOMEDIR, ...p);
const appSupport = (...p) =>
  process.platform === 'darwin' ? home('Library', 'Application Support', ...p)
    : process.platform === 'win32' ? path.join(process.env.APPDATA || home('AppData', 'Roaming'), ...p)
      : home('.config', ...p);
const exists = (f) => { try { fs.accessSync(f); return true; } catch { return false; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

function sh(cmd, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, timeout, maxBuffer: 8 * 1024 * 1024, cwd: HOMEDIR }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
  });
}
function which(bin) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    for (const ext of process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']) {
      const f = path.join(dir, bin + ext);
      if (dir && exists(f)) return f;
    }
  }
  return null;
}
const firstApp = (names) => names.map((n) => (process.platform === 'darwin' ? `/Applications/${n}.app` : null)).find((f) => f && exists(f)) || null;

// One MCP entry, the same shape whatever tool it came from. Secrets in env/headers are never
// returned to the page: only their names.
function slimServer(name, def = {}, from) {
  const url = def.url || def.serverUrl || def.httpUrl || null;
  return {
    name, from,
    type: def.type || (url ? (/sse/i.test(url) ? 'sse' : 'http') : 'stdio'),
    command: def.command ? [def.command, ...(def.args || [])].join(' ').slice(0, 200) : null,
    url,
    envKeys: Object.keys(def.env || def.headers || {}),
    disabled: !!def.disabled,
  };
}
const mcpFrom = (obj, from) => Object.entries(obj || {}).map(([n, d]) => slimServer(n, d, from));

// Codex keeps MCP servers in TOML ([mcp_servers.name] tables). Enough of TOML for that.
function codexServers(file) {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = {};
  let cur = null;
  for (const line of txt.split('\n')) {
    const head = line.match(/^\s*\[mcp_servers\.("?)([^"\]]+)\1\]\s*$/);
    if (head) { cur = out[head[2]] = {}; continue; }
    if (/^\s*\[/.test(line)) { cur = null; continue; }
    const kv = cur && line.match(/^\s*([A-Za-z_]+)\s*=\s*(.+?)\s*$/);
    if (!kv) continue;
    try { cur[kv[1]] = JSON.parse(kv[2].replace(/'/g, '"')); } catch { cur[kv[1]] = kv[2].replace(/^"|"$/g, ''); }
  }
  return mcpFrom(out, file);
}

function instr(file, label) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || !st.size) return null;
    const head = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const title = (head.match(/^#\s+(.+)$/m) || [])[1] || label || path.basename(file);
    const rules = (head.match(/^\s*([-*]|\d+\.)\s+\S/gm) || []).length + (head.match(/^##\s/gm) || []).length;
    return { path: file, label: label || path.basename(file), title: title.slice(0, 80), bytes: st.size, updatedAt: st.mtime.toISOString(), rules };
  } catch { return null; }
}
const dirFiles = (dir, re) => { try { return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)); } catch { return []; } };
const countDirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).length; } catch { return 0; } };

// Every tool Work Center knows. `engine` means it can do Work Center's AI work headlessly.
const TOOLS = [
  {
    id: 'claude', name: 'Claude Code', vendor: 'Anthropic', bins: ['claude'], engine: true,
    look() {
      const cj = readJson(home('.claude.json')) || {};
      const acct = cj.oauthAccount || {};
      const projectMcp = Object.values(cj.projects || {}).reduce((n, p) => n + Object.keys(p.mcpServers || {}).length, 0);
      return {
        configured: exists(home('.claude')) || exists(home('.claude.json')),
        account: acct.emailAddress ? { email: acct.emailAddress, name: acct.displayName || acct.fullName || null, org: acct.organizationName || null } : null,
        mcp: mcpFrom(cj.mcpServers, home('.claude.json')),
        mcpFile: home('.claude.json'),
        projectMcp,
        instructions: [instr(home('.claude', 'CLAUDE.md'), 'CLAUDE.md')],
        skills: countDirs(home('.claude', 'skills')),
      };
    },
  },
  {
    id: 'claude-desktop', name: 'Claude app', vendor: 'Anthropic', apps: ['Claude'],
    look() {
      const f = appSupport('Claude', 'claude_desktop_config.json');
      return { configured: exists(f), mcp: mcpFrom(readJson(f)?.mcpServers, f), mcpFile: f };
    },
  },
  {
    id: 'cursor', name: 'Cursor', vendor: 'Anysphere', bins: ['cursor-agent', 'cursor'], apps: ['Cursor'], engine: true, engineBin: 'cursor-agent',
    look() {
      const f = home('.cursor', 'mcp.json');
      return {
        configured: exists(home('.cursor')),
        mcp: mcpFrom(readJson(f)?.mcpServers, f), mcpFile: f,
        instructions: dirFiles(home('.cursor', 'rules'), /\.(md|mdc)$/).map((p) => instr(p)),
        skills: countDirs(home('.cursor', 'skills')),
      };
    },
  },
  {
    id: 'gemini', name: 'Gemini CLI', vendor: 'Google', bins: ['gemini'], engine: true,
    look() {
      const f = home('.gemini', 'settings.json');
      return {
        configured: exists(home('.gemini')),
        mcp: mcpFrom(readJson(f)?.mcpServers, f), mcpFile: f,
        instructions: [instr(home('.gemini', 'GEMINI.md'), 'GEMINI.md')],
        skills: countDirs(home('.gemini', 'skills')),
      };
    },
  },
  {
    id: 'codex', name: 'Codex (ChatGPT)', vendor: 'OpenAI', bins: ['codex'], engine: true,
    look() {
      const f = home('.codex', 'config.toml');
      return {
        configured: exists(home('.codex')),
        mcp: codexServers(f), mcpFile: f,
        instructions: [instr(home('.codex', 'AGENTS.md'), 'AGENTS.md')],
      };
    },
  },
  { id: 'chatgpt', name: 'ChatGPT app', vendor: 'OpenAI', apps: ['ChatGPT'], look: () => ({ configured: false, chatOnly: true }) },
  {
    id: 'windsurf', name: 'Windsurf', vendor: 'Codeium', apps: ['Windsurf'],
    look() {
      const f = home('.codeium', 'windsurf', 'mcp_config.json');
      return {
        configured: exists(home('.codeium', 'windsurf')),
        mcp: mcpFrom(readJson(f)?.mcpServers, f), mcpFile: f,
        instructions: [instr(home('.codeium', 'windsurf', 'memories', 'global_rules.md'), 'global_rules.md')],
      };
    },
  },
  {
    id: 'copilot', name: 'GitHub Copilot CLI', vendor: 'GitHub', bins: ['copilot'],
    look() {
      const f = home('.copilot', 'mcp-config.json');
      return { configured: exists(home('.copilot')), mcp: mcpFrom(readJson(f)?.mcpServers, f), mcpFile: f };
    },
  },
  {
    id: 'vscode', name: 'VS Code', vendor: 'Microsoft', apps: ['Visual Studio Code'], bins: ['code'],
    look() {
      const f = appSupport('Code', 'User', 'mcp.json');
      return { configured: exists(appSupport('Code', 'User')), mcp: mcpFrom(readJson(f)?.servers, f), mcpFile: f };
    },
  },
  {
    id: 'opencode', name: 'opencode', vendor: 'SST', bins: ['opencode'],
    look() {
      const f = home('.config', 'opencode', 'opencode.json');
      return { configured: exists(f), mcp: mcpFrom(readJson(f)?.mcp, f), mcpFile: f, instructions: [instr(home('.config', 'opencode', 'AGENTS.md'), 'AGENTS.md')] };
    },
  },
  { id: 'aider', name: 'Aider', vendor: 'Aider', bins: ['aider'], look: () => ({ configured: exists(home('.aider.conf.yml')), instructions: [instr(home('.aider.conf.yml'), '.aider.conf.yml')] }) },
  { id: 'ollama', name: 'Ollama (local models)', vendor: 'Ollama', bins: ['ollama'], apps: ['Ollama'], local: true, look: () => ({ configured: exists(home('.ollama')) }) },
];

// claude.ai connectors (Slack, Atlassian, Gmail…) live in the person's Claude account, not in a
// local file, so they come from `claude mcp list`, which also health-checks every server (slow:
// cached, refreshed in the background).
let connCache = null;
let connRunning = null;
function claudeConnections(cacheFile, { force = false } = {}) {
  if (!connCache) connCache = readJson(cacheFile);
  const fresh = connCache?.fetchedAt && Date.now() - new Date(connCache.fetchedAt) < 30 * 60_000;
  if ((force || !fresh) && !connRunning && which('claude')) {
    connRunning = sh('claude', ['mcp', 'list'], 120_000).then((r) => {
      const items = [];
      for (const line of r.out.split('\n')) {
        const m = line.match(/^(.+?):\s+(.+?)\s+-\s+(.+)$/);
        if (!m) continue;
        const status = /connected/i.test(m[3]) && !/not|fail/i.test(m[3]) ? 'connected' : /auth/i.test(m[3]) ? 'needs-auth' : 'failed';
        const cloud = m[1].startsWith('claude.ai ');
        items.push({ name: cloud ? m[1].slice(10) : m[1], cloud, target: m[2].slice(0, 200), status });
      }
      if (items.length || r.ok) {
        connCache = { fetchedAt: new Date().toISOString(), items };
        try { fs.writeFileSync(cacheFile, JSON.stringify(connCache, null, 2)); } catch { /* data dir gone */ }
      }
    }).finally(() => (connRunning = null));
  }
  return { ...(connCache || { items: [] }), checking: !!connRunning };
}

async function amemInfo(toolsOut) {
  const bin = which('amem');
  const homeDir = process.env.AMEM_HOME || home('.amem');
  const info = { installed: !!bin, bin, home: exists(homeDir) ? homeDir : null, version: null, connectedIn: [], missingIn: [] };
  if (bin) {
    const v = await sh('npm', ['ls', '-g', '@iamem/amem', '--json', '--depth=0'], 8000);
    try { info.version = JSON.parse(v.out).dependencies?.['@iamem/amem']?.version || null; } catch { /* npm absent */ }
  }
  for (const t of toolsOut) {
    if (!t.present || !t.mcpFile || t.id === 'chatgpt') continue;
    (t.mcp.some((m) => /^amem$/i.test(m.name)) ? info.connectedIn : info.missingIn).push(t.id);
  }
  return info;
}

// What Work Center itself needs, and which tool provides it.
const NEEDS = [
  { id: 'github', area: 'GitHub', why: 'PRs, reviews, merges', mcp: /github/i, cli: 'gh' },
  { id: 'jira', area: 'Jira', why: 'sprint, bugs, mentions', mcp: /atlassian|jira/i, cli: 'twg' },
  { id: 'slack', area: 'Slack', why: 'messages that need you', mcp: /slack/i },
  { id: 'calendar', area: 'Calendar', why: 'meetings and invites', mcp: /calendar|outlook|notion/i },
  { id: 'email', area: 'Email', why: 'mail that needs a reply', mcp: /gmail|outlook|mail/i },
  { id: 'notes', area: 'Meeting notes', why: 'prep and action items', mcp: /granola|undertone|meetings|fireflies|otter|fathom|read\.ai|notion/i },
  { id: 'memory', area: 'Memory', why: 'remembers across runs', mcp: /^amem$|memory/i },
];

async function detect({ dataDir, engineId, force = false } = {}) {
  const tools = await Promise.all(TOOLS.map(async (t) => {
    const binPath = (t.bins || []).map(which).find(Boolean) || null;
    const app = firstApp(t.apps || []);
    let info = {};
    try { info = t.look() || {}; } catch (e) { info = { error: e.message }; }
    const present = !!(binPath || app || info.configured);
    let version = null;
    if (binPath) {
      const v = await sh(binPath, ['--version'], 5000);
      version = (v.out || v.err).trim().split('\n')[0].replace(/^[^\d]*(?=\d)/, '').slice(0, 40) || null;
    }
    const engineBin = t.engine ? which(t.engineBin || t.bins[0]) : null;
    return {
      id: t.id, name: t.name, vendor: t.vendor, present, bin: binPath, app, version,
      engine: !!engineBin, local: !!t.local, chatOnly: !!info.chatOnly,
      account: info.account || null,
      mcp: info.mcp || [], mcpFile: info.mcpFile || null, projectMcp: info.projectMcp || 0,
      instructions: (info.instructions || []).filter(Boolean),
      skills: info.skills || 0,
    };
  }));
  const conns = dataDir ? claudeConnections(path.join(dataDir, 'connections.json'), { force }) : { items: [] };

  // One row per MCP server name, with every tool that has it.
  const byName = new Map();
  const add = (name, toolId, extra) => {
    const key = name.toLowerCase().replace(/[\s_-]+/g, '');
    const row = byName.get(key) || { name, tools: [], status: null, cloud: false, def: null };
    if (!row.tools.includes(toolId)) row.tools.push(toolId);
    Object.assign(row, extra);
    byName.set(key, row);
  };
  for (const t of tools) for (const m of t.mcp) add(m.name, t.id, { def: m });
  for (const c of conns.items) add(c.name, 'claude', { status: c.status, cloud: c.cloud || undefined });
  const mcp = [...byName.values()].sort((a, b) => b.tools.length - a.tools.length || a.name.localeCompare(b.name));

  const engine = tools.find((t) => t.id === engineId && t.engine) || tools.find((t) => t.engine) || null;
  const amem = await amemInfo(tools);
  const ghAuth = which('gh') ? await sh('gh', ['auth', 'status'], 8000) : null;
  const needs = NEEDS.map((n) => {
    const rows = mcp.filter((m) => n.mcp.test(m.name) && m.status !== 'failed');
    const onEngine = rows.filter((m) => engine && m.tools.includes(engine.id) && m.status !== 'needs-auth');
    const cli = n.cli && which(n.cli) ? n.cli : null;
    const cliOk = cli && (cli !== 'gh' || ghAuth?.ok);
    const ok = n.id === 'memory' ? amem.installed : !!(cliOk || onEngine.length);
    return {
      id: n.id, area: n.area, why: n.why, ok,
      via: [cliOk ? `${cli} CLI` : null, ...onEngine.map((m) => m.name)].filter(Boolean).slice(0, 3),
      elsewhere: ok ? [] : rows.map((m) => ({ name: m.name, tools: m.tools, status: m.status })).slice(0, 3),
    };
  });
  return {
    checkedAt: new Date().toISOString(),
    os: `${os.type()} ${os.release()}`,
    tools: tools.sort((a, b) => b.present - a.present || b.engine - a.engine),
    engine: engine ? { id: engine.id, name: engine.name } : null,
    mcp, connections: { fetchedAt: conns.fetchedAt || null, checking: conns.checking },
    instructions: tools.flatMap((t) => t.instructions.map((i) => ({ ...i, tool: t.id, toolName: t.name }))),
    amem, needs,
    github: ghAuth ? { ok: ghAuth.ok, login: ((ghAuth.out + ghAuth.err).match(/account\s+(\S+)/) || [])[1] || null } : null,
  };
}

module.exports = { detect, which, sh, home, appSupport, readJson, TOOLS };
