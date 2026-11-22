/* Settings and first-run setup: the AI tools on this machine, what they connect to, the rules written
   for them, memory (amem) and the person's profile. Uses page globals: h, $, D, post, toast, load, HQ. */
(() => {
  const OV = 'settings-ov';
  let S = null; // last /api/setup
  let tab = 'overview';
  let poll = null;
  let welcomed = false;

  const pill = (cls, txt) => h('span', { class: `pill ${cls}` }, txt);
  const fmtBytes = (n) => (n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
  const toolName = (id) => S?.tools.find((t) => t.id === id)?.name || id;

  async function fetchSetup(force) {
    try { S = await (await fetch(`/api/setup${force ? '?force' : ''}`)).json(); } catch (e) { toast(`Settings: ${e.message}`); }
    return S;
  }

  async function open(which) {
    if (which) tab = which;
    const ov = HQ.overlay(OV);
    ov.hidden = false;
    if (!S) { ov.replaceChildren(h('div', { class: 'st-box' }, h('div', { class: 'st-loading' }, 'Checking your AI tools…'))); await fetchSetup(); }
    paint();
    if (S?.connections?.checking) watchChecks();
  }
  window.openSettings = open;

  function watchChecks() {
    clearTimeout(poll);
    poll = setTimeout(async () => {
      if ($(OV)?.hidden) return;
      await fetchSetup();
      paint();
      if (S?.job?.running || S?.connections?.checking) watchChecks();
    }, 3000);
  }

  async function runSetup() {
    try { await post('/api/setup/run'); } catch (e) { return toast(e.message); }
    await fetchSetup();
    tab = 'overview';
    paint();
    watchChecks();
  }

  async function save(patch, msg = 'Saved') {
    try { await post('/api/settings', { patch }); toast(msg); } catch (e) { return toast(e.message); }
    await fetchSetup();
    paint();
    load(true);
  }

  async function copyServer(name, from, to) {
    if (!confirm(`Add the "${name}" connection from ${toolName(from)} to ${toolName(to)}? Its settings (including any keys it uses) are copied into ${toolName(to)}'s config on this computer.`)) return;
    try {
      const r = await post('/api/setup/mcp-add', { name, from, to });
      toast(r.already ? `${toolName(to)} already has ${name}` : `Added ${name} to ${toolName(to)}${to === 'claude' ? '' : ' (restart it to load)'}`);
    } catch (e) { return toast(e.message); }
    await fetchSetup(true);
    paint();
  }

  async function amem(action, tool) {
    if (action === 'install' && !confirm('Install amem (npm install -g @iamem/amem)? It keeps a private memory on this computer that your AI tools share.')) return;
    toast(action === 'install' ? 'Installing amem…' : `Connecting amem to ${toolName(tool)}…`);
    try { await post('/api/setup/amem', { action, tool }); toast(action === 'install' ? 'amem installed' : `amem connected to ${toolName(tool)}`); } catch (e) { return toast(e.message); }
    await fetchSetup(true);
    paint();
  }

  /* ---------- tabs ---------- */
  function overview() {
    const j = S.job;
    const present = S.tools.filter((t) => t.present);
    const first = !S.setupDoneAt;
    return h('div', { class: 'st-pane' },
      first ? h('div', { class: 'st-hero' },
        h('b', {}, 'Welcome to Work Center'),
        h('p', {}, `Found ${present.length} AI tool${present.length === 1 ? '' : 's'} on this computer, ${S.mcp.length} connections and ${S.instructions.length} rule file${S.instructions.length === 1 ? '' : 's'}. Set me up connects memory, reads your accounts and works out your role, repos, tracker and chat, so the desk shows your own work.`),
        h('button', { class: 'btn go st-big', disabled: j?.running, onclick: runSetup }, j?.running ? 'Setting you up…' : 'Set me up')) : null,
      j ? h('div', { class: `st-card st-job ${j.running ? 'busy' : j.error ? 'bad' : 'ok'}` },
        h('div', { class: 'st-row' }, h('b', {}, j.running ? 'Setting you up' : j.error ? 'Setup stopped' : 'Setup finished'),
          h('span', { class: 'muted small' }, new Date(j.finishedAt || j.startedAt).toLocaleString()),
          h('span', { class: 'st-gap' }), !j.running && !first ? h('button', { class: 'btn', onclick: runSetup }, 'Run setup again') : null),
        h('ol', { class: 'st-steps' }, j.steps.map((s) => h('li', { class: s.status },
          h('span', { class: 'st-ic' }, { done: '✓', failed: '!', running: '…', pending: '·', skipped: '–' }[s.status]),
          h('span', {}, s.label), s.note ? h('small', {}, s.note) : null))),
        j.error ? h('div', { class: 'blocked small' }, j.error) : null) : null,
      h('div', { class: 'st-sub' }, 'What Work Center can reach'),
      h('div', { class: 'st-needs' }, S.needs.map((n) => h('div', { class: `st-need ${n.ok ? 'ok' : 'no'}` },
        h('div', { class: 'st-row' }, h('span', { class: 'st-dot' }), h('b', {}, n.area), h('span', { class: 'muted small' }, n.why)),
        n.ok ? h('small', {}, `via ${n.via.join(', ') || 'connected'}`)
          : n.elsewhere.length ? h('small', {}, `In ${n.elsewhere[0].tools.map(toolName).join(', ')} only: `,
            S.engineNow && S.targets.includes(S.engineNow.tool) && !n.elsewhere[0].tools.includes(S.engineNow.tool)
              ? h('button', { class: 'linkbtn', onclick: () => copyServer(n.elsewhere[0].name, n.elsewhere[0].tools[0], S.engineNow.tool) }, `add ${n.elsewhere[0].name} to ${S.engineNow.name}`)
              : `${n.elsewhere[0].name}${n.elsewhere[0].status === 'needs-auth' ? ' (needs sign-in)' : ''}`)
            : h('small', { class: 'muted' }, n.id === 'memory' ? 'Not installed' : `Connect ${n.area} in your AI tool (an MCP server or connector)`)))),
      S.connections.checking ? h('div', { class: 'muted small' }, 'Still checking your account connectors (Slack, calendar…); this updates by itself.') : null,
      h('div', { class: 'st-sub' }, 'Which AI does the work'),
      engineRow());
  }

  function engineRow() {
    const cur = S.settings.ai?.engine || '';
    return h('div', { class: 'st-card st-row' },
      h('span', {}, 'AI engine'),
      h('select', { class: 'st-in', onchange: (e) => save({ ai: { engine: e.target.value || null } }, 'Engine saved') },
        h('option', { value: '', selected: !cur }, `Automatic (${S.engineNow?.name || 'none found'})`),
        S.engines.map((e) => h('option', { value: e.id, selected: cur === e.id, disabled: !e.available }, `${{ claude: 'Claude Code', cursor: 'Cursor Agent', gemini: 'Gemini CLI', codex: 'Codex (ChatGPT)' }[e.id]}${e.available ? '' : ' (not installed)'}`))),
      h('span', { class: 'muted small' }, 'Runs on your own plan with that tool; no API keys are stored in Work Center.'));
  }

  function tools() {
    return h('div', { class: 'st-pane st-grid' }, S.tools.map((t) => h('div', { class: `st-card st-tool ${t.present ? '' : 'off'}` },
      h('div', { class: 'st-row' }, h('b', {}, t.name), h('span', { class: 'muted small' }, t.vendor), h('span', { class: 'st-gap' }),
        S.engineNow?.tool === t.id ? pill('green', 'Doing the work') : t.engine ? pill('blue', 'Can do the work') : t.present ? pill('', t.chatOnly ? 'Chat app' : t.local ? 'Local models' : 'Found') : pill('', 'Not found')),
      t.present ? h('div', { class: 'st-meta' },
        t.version ? h('span', {}, `v${t.version}`) : null,
        t.account ? h('span', {}, `${t.account.email}${t.account.org ? ` · ${t.account.org}` : ''}`) : null,
        h('span', {}, `${t.mcp.length} connection${t.mcp.length === 1 ? '' : 's'}`),
        t.instructions.length ? h('span', {}, `${t.instructions.length} rule file${t.instructions.length === 1 ? '' : 's'}`) : null,
        t.skills ? h('span', {}, `${t.skills} skills`) : null) : null,
      t.mcp.length ? h('div', { class: 'st-chips' }, t.mcp.slice(0, 14).map((m) => h('span', { class: 'chip sm', title: m.url || m.command || '' }, m.name))) : null)));
  }

  function connections() {
    const eng = S.engineNow?.tool;
    const cols = S.tools.filter((t) => t.present && (t.mcp.length || t.id === eng)).map((t) => t.id);
    return h('div', { class: 'st-pane' },
      h('p', { class: 'muted small' }, `Every MCP server and connector your AI tools use. ${S.engineNow ? `${S.engineNow.name} does Work Center's work, so a connection only helps here once ${S.engineNow.name} has it.` : ''} ${S.connections.fetchedAt ? `Connector status checked ${new Date(S.connections.fetchedAt).toLocaleTimeString()}.` : ''}`,
        h('button', { class: 'linkbtn', onclick: async () => { await fetchSetup(true); paint(); watchChecks(); } }, S.connections.checking ? ' Checking…' : ' Check again')),
      h('div', { class: 'st-table-wrap' }, h('table', { class: 'st-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Connection'), cols.map((c) => h('th', {}, toolName(c))), h('th', {}, ''))),
        h('tbody', {}, S.mcp.map((m) => h('tr', {},
          h('td', {}, h('b', {}, m.name), m.cloud ? h('small', { class: 'muted' }, ' account connector') : null,
            m.status === 'needs-auth' ? pill('amber', 'needs sign-in') : m.status === 'failed' ? pill('red', 'failing') : null),
          cols.map((c) => h('td', { class: 'st-c' }, m.tools.includes(c) ? '●' : '')),
          h('td', {}, eng && !m.tools.includes(eng) && S.targets.includes(eng) && !m.cloud && m.def
            ? h('button', { class: 'btn st-sm', onclick: () => copyServer(m.name, m.tools.find((x) => x !== 'codex') || m.tools[0], eng) }, `Add to ${S.engineNow.name}`) : null)))))));
  }

  function rules() {
    const shared = new Set(S.settings.ai?.shareInstructions || []);
    let draft = S.settings.ai?.rules || '';
    return h('div', { class: 'st-pane' },
      h('p', { class: 'muted small' }, `${S.engineNow?.name || 'Your AI'} already follows its own rule files. Share rules you wrote for other tools so Work Center's AI follows them too.`),
      S.instructions.length ? S.instructions.map((i) => h('div', { class: 'st-card st-row' },
        h('div', { class: 'st-grow' }, h('b', {}, i.title), h('div', { class: 'muted small' }, `${i.toolName} · ${i.label} · ${i.rules} rules · ${fmtBytes(i.bytes)} · ${i.path}`)),
        S.engineNow?.tool === i.tool ? pill('green', 'Used already')
          : h('label', { class: 'st-toggle' }, h('input', { type: 'checkbox', checked: shared.has(i.path), onchange: (e) => {
            const next = new Set(shared); e.target.checked ? next.add(i.path) : next.delete(i.path);
            save({ ai: { shareInstructions: [...next] } }, e.target.checked ? 'Shared with Work Center' : 'No longer shared');
          } }), ' Use in Work Center'))) : h('div', { class: 'muted' }, 'No rule files found (CLAUDE.md, GEMINI.md, AGENTS.md, Cursor or Windsurf rules).'),
      h('div', { class: 'st-sub' }, 'Work Center rules'),
      h('textarea', { class: 'st-in st-area', rows: 6, placeholder: 'Rules only for Work Center\'s AI, e.g. "Never post in #general" or "Draft replies in Spanish".', oninput: (e) => (draft = e.target.value) }, draft),
      h('div', { class: 'st-row' }, h('button', { class: 'btn go', onclick: () => save({ ai: { rules: draft } }, 'Rules saved') }, 'Save rules')));
  }

  function memory() {
    const a = S.amem;
    return h('div', { class: 'st-pane' },
      h('div', { class: 'st-card' },
        h('div', { class: 'st-row' }, h('b', {}, 'amem'), a.installed ? pill('green', 'Installed') : pill('amber', 'Not installed'), h('span', { class: 'st-gap' }),
          a.installed ? null : h('button', { class: 'btn go', onclick: () => amem('install') }, 'Install amem')),
        h('p', { class: 'muted small' }, 'A private memory on this computer that every AI tool can share: decisions, people, how-tos, work logs. Work Center uses it for standups and to avoid repeating work.'),
        a.installed ? h('div', { class: 'muted small' }, `${a.bin}${a.home ? ` · data in ${a.home}` : ''}`) : null),
      a.installed ? h('div', { class: 'st-sub' }, 'Connected tools') : null,
      a.installed ? h('div', { class: 'st-grid' },
        [...a.connectedIn.map((id) => [id, true]), ...a.missingIn.map((id) => [id, false])].map(([id, on]) => h('div', { class: 'st-card st-row' },
          h('b', {}, toolName(id)), h('span', { class: 'st-gap' }),
          on ? pill('green', 'Connected') : S.targets.includes(id) ? h('button', { class: 'btn st-sm', onclick: () => amem('connect', id) }, 'Connect') : pill('', 'Manual setup')))) : null);
  }

  function profile() {
    const s = S.settings;
    const v = JSON.parse(JSON.stringify({ owner: s.owner || {}, github: s.github || {}, jira: s.jira || {}, workDir: s.workDir || '' }));
    const field = (label, obj, key, ph, help) => h('label', { class: 'st-field' }, h('span', {}, label),
      h('input', { class: 'st-in', value: Array.isArray(obj[key]) ? obj[key].join(', ') : obj[key] || '', placeholder: ph || '', oninput: (e) => (obj[key] = key === 'orgs' ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : e.target.value.trim()) }),
      help ? h('small', { class: 'muted' }, help) : null);
    const wd = { workDir: v.workDir };
    return h('div', { class: 'st-pane' },
      S.proposal ? h('p', { class: 'muted small' }, `Filled in by setup on ${new Date(S.proposal.at).toLocaleDateString()}.${S.proposal.notes ? ` ${S.proposal.notes}` : ''} Your edits always win.`) : null,
      h('div', { class: 'st-sub' }, 'You'),
      h('div', { class: 'st-form' }, field('Name', v.owner, 'name'), field('Work email', v.owner, 'email'), field('Role', v.owner, 'role', 'e.g. Backend engineer'), field('Company', v.owner, 'company')),
      h('div', { class: 'st-sub' }, 'GitHub'),
      h('div', { class: 'st-form' }, field('Login', v.github, 'login'), field('Main repo', v.github, 'repo', 'owner/name', 'PR verdicts and one-click merges'), field('Orgs', v.github, 'orgs', 'acme, acme-labs', 'Only show review requests from these')),
      h('div', { class: 'st-sub' }, 'Jira'),
      h('div', { class: 'st-form' }, field('Site', v.jira, 'site', 'https://acme.atlassian.net'), field('Sprint query', v.jira, 'sprint'), field('Bugs query', v.jira, 'bugs'), field('Mentions query', v.jira, 'mentions'), field('PRD review query (optional)', v.jira, 'prdQa', '', 'Turns on the PRD QA board')),
      h('div', { class: 'st-sub' }, 'Slack'),
      h('div', { class: 'st-form' }, field('Your user id', v.owner, 'slackId', 'U…', 'Turns on the phone\'s Slack check'), field('Team id', v.owner, 'slackTeamId', 'T…'), field('Workspace', v.owner, 'slackDomain', 'acme.slack.com')),
      h('div', { class: 'st-sub' }, 'Where the AI works'),
      h('div', { class: 'st-form' }, field('Work folder', wd, 'workDir', '~/code/main-repo', 'AI runs start here, with that folder\'s rules')),
      h('div', { class: 'st-row' }, h('button', { class: 'btn go', onclick: () => save({ owner: v.owner, github: v.github, jira: v.jira, workDir: wd.workDir || null }, 'Profile saved') }, 'Save profile'),
        h('span', { class: 'muted small' }, `Saved to ${S.settingsFile}`)));
  }

  const TABS = [['overview', 'Overview', overview], ['tools', 'AI tools', tools], ['connections', 'Connections', connections], ['rules', 'Rules', rules], ['memory', 'Memory', memory], ['profile', 'Profile', profile]];
  function paint() {
    const ov = HQ.overlay(OV);
    if (ov.hidden || !S) return;
    if (S.error) return ov.replaceChildren(h('div', { class: 'st-box' }, h('div', { class: 'blocked' }, S.error)));
    const cur = TABS.find((t) => t[0] === tab) || TABS[0];
    let body;
    try { body = cur[2](); } catch (e) { body = h('div', { class: 'blocked' }, e.message); }
    ov.replaceChildren(h('div', { class: 'st-box', role: 'dialog', 'aria-label': 'Settings' },
      h('div', { class: 'st-head' }, h('h2', { class: 'st-title' }, 'Settings'),
        h('span', { class: 'muted small' }, S.engineNow ? `AI: ${S.engineNow.name}` : 'No AI CLI found'),
        h('span', { class: 'st-gap' }), h('button', { class: 'btn ghost', onclick: () => HQ.closeOverlay(OV) }, 'Close')),
      h('div', { class: 'st-tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', { class: `st-tab ${id === tab ? 'on' : ''}`, role: 'tab', 'aria-selected': id === tab ? 'true' : 'false', onclick: () => { tab = id; paint(); } }, label))),
      body));
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$(OV)?.hidden) HQ.closeOverlay(OV); });
  HQ.onRender(() => {
    // First run: open Settings on the welcome screen once.
    if (!welcomed && D?.config && !D.config.setupDone) { welcomed = true; open('overview'); }
  });
})();
