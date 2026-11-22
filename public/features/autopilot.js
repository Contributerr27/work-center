/* Autopilot: standing rules the AI runs on a schedule, with a kill switch.
   Server side: src/features/autopilot.js. State arrives as D.ext.autopilot and from GET /api/autopilot. */
(function () {
  const OV = 'autopilot-ov';
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const SEC_NAMES = { github: 'Pull requests', jira: 'Jira', slack: 'Slack', work: 'Work', meet: 'Meetings' };
  let AP = null; // last state from the server
  let view = 'list'; // list | pick | edit
  let editId = null;
  let isOpen = false;
  let poll = null;

  const secName = (id) => (typeof FLOW !== 'undefined' && FLOW.find((s) => s.id === id)?.name) || SEC_NAMES[id] || id;
  const sections = () => (typeof FLOW !== 'undefined' ? FLOW.map((s) => s.id) : Object.keys(SEC_NAMES));

  function daysText(d) {
    if (!d || !d.length || d.length === 7) return 'every day';
    const s = [...d].sort().join(',');
    if (s === '1,2,3,4,5') return 'weekdays';
    if (s === '0,6') return 'weekends';
    return d.map((x) => DAY[x]).join(' ');
  }
  function scheduleText(s) {
    if (!s) return '?';
    if (s.at) return `${daysText(s.days)} ${s.at}`;
    const every = s.everyMinutes % 60 === 0 ? `${s.everyMinutes / 60} h` : `${s.everyMinutes} min`;
    const hrs = s.fromHour != null || s.toHour != null ? ` · ${s.fromHour ?? 0}–${s.toHour ?? 24}h` : '';
    const ds = s.days?.length && s.days.length < 7 ? ` · ${daysText(s.days)}` : '';
    return `every ${every}${ds}${hrs}`;
  }
  function inText(iso) {
    if (!iso) return null;
    const m = Math.round((new Date(iso) - Date.now()) / 60000);
    if (m <= 0) return 'now';
    if (m < 60) return `in ${m}m`;
    if (m < 24 * 60) return `in ${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
    const d = new Date(iso);
    return `${DAY[d.getDay()]} ${time(iso)}`;
  }
  function agoText(iso) {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (m < 24 * 60) return `${Math.floor(m / 60)}h ago`;
    return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  async function refresh() {
    try {
      AP = await (await fetch('/api/autopilot')).json();
      if (D) D.ext = { ...(D.ext || {}), autopilot: AP };
    } catch (e) { /* server restarting */ }
    paint();
    renderIndicator();
  }
  async function act(path, body, okMsg) {
    try {
      AP = await post(path, body);
      if (D) D.ext = { ...(D.ext || {}), autopilot: AP };
      if (okMsg) toast(okMsg);
      renderIndicator();
      if ((path.endsWith('/run') || path.endsWith('/pause')) && typeof pollPings === 'function') pollPings();
      return AP;
    } catch (e) {
      toast(e.message);
      return null;
    } finally {
      paint();
    }
  }

  const OUTWARD_WARN = (r) => `"${r.name}" acts outside the app on its own (${secName(r.section)}): it does exactly what its prompt allows, on schedule, without asking.\n\nTurn it on?`;

  async function toggle(r, on) {
    if (on && r.outward && !confirm(OUTWARD_WARN(r))) return paint();
    await act('/api/autopilot/rule/toggle', { id: r.id, enabled: on, confirm: on && r.outward }, on ? `${r.name} is on` : `${r.name} is off`);
  }
  async function runNow(r) {
    if (r.outward && !confirm(`Run "${r.name}" now? It acts outside the app (${secName(r.section)}).`)) return;
    const s = await act('/api/autopilot/rule/run', { id: r.id, confirm: r.outward }, `${r.name} started · watch it in ${secName(r.section)}`);
    if (s) load(false);
  }

  /* ---------- Overlay ---------- */
  function open() {
    isOpen = true;
    view = 'list';
    const ov = HQ.overlay(OV);
    ov.hidden = false;
    ov.onclick = (e) => { if (e.target === ov) close(); };
    refresh();
    clearInterval(poll);
    poll = setInterval(() => { if (view === 'list') refresh(); }, 15000);
  }
  function close() {
    isOpen = false;
    clearInterval(poll);
    HQ.closeOverlay(OV);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });

  function killSwitch() {
    const paused = !!AP?.paused;
    const running = AP?.running || 0;
    return h('div', { class: `ap-kill ${paused ? 'paused' : ''}` },
      h('button', {
        class: 'ap-big', 'aria-pressed': paused ? 'true' : 'false',
        title: paused ? 'Resume Autopilot' : 'Pause all rules and stop every running Autopilot job',
        onclick: async () => {
          if (paused) return act('/api/autopilot/resume', {}, 'Autopilot resumed');
          if (running && !confirm(`Pause Autopilot and stop ${running} running job${running === 1 ? '' : 's'}? Anything already done stays done.`)) return;
          const s = await act('/api/autopilot/pause', {});
          if (s) toast(s.stopped ? `Paused · stopped ${s.stopped} job${s.stopped === 1 ? '' : 's'}` : 'Autopilot paused');
        },
      }, h('span', { class: 'ap-big-ic' }, paused ? '▶' : '■'), h('span', { class: 'ap-big-t' }, paused ? 'Resume' : 'Pause all')),
      h('div', { class: 'ap-kill-txt' },
        h('b', {}, paused ? 'Autopilot is paused' : AP?.enabledCount ? `Autopilot on · ${AP.enabledCount} rule${AP.enabledCount === 1 ? '' : 's'}` : 'Autopilot is idle'),
        h('span', { class: 'muted small' }, paused ? 'No rule runs until you resume.'
          : running ? `${running} running now. Pause all stops them.` : 'Pause all stops every rule and every running job at once.'),
        AP?.scheduler === 'other' && h('span', { class: 'muted small' }, 'Another open copy of Work Center runs the schedule.')));
  }

  function statusPill(r) {
    if (r.running) return h('span', { class: 'pill blue' }, h('span', { class: 'spin' }), 'Running');
    const m = { ok: ['green', '✓ Done'], error: ['red', '✕ Failed'], stopped: ['amber', '■ Stopped'], running: ['blue', 'Running'] }[r.lastStatus];
    return m ? h('span', { class: `pill ${m[0]}` }, m[1]) : h('span', { class: 'pill' }, 'Never run');
  }

  function card(r) {
    const cmd = (D?.commands || []).find((c) => c.id === r.lastCommandId);
    const next = r.enabled && !AP.paused ? inText(r.nextRunAt) : null;
    return h('div', { class: `ap-card ${r.enabled ? 'on' : 'off'} ${r.running ? 'busy' : ''}` },
      h('div', { class: 'ap-row' },
        h('label', { class: 'ap-switch', title: r.enabled ? 'Turn off' : 'Turn on' },
          h('input', { type: 'checkbox', checked: r.enabled, onchange: (e) => toggle(r, e.target.checked) }), h('i', {})),
        h('b', { class: 'ap-name', title: r.name }, r.name),
        r.outward && h('span', { class: 'pill red ap-warn', title: 'Acts outside the app (approves, merges, comments…)' }, '⚠ Acts outside'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm go', disabled: !!r.running || !!AP.paused, title: AP.paused ? 'Resume Autopilot first' : 'Run this rule now', onclick: () => runNow(r) }, '▶ Run now'),
        h('button', { class: 'btn sm', onclick: () => { view = 'edit'; editId = r.id; paint(); } }, 'Edit'),
        h('button', { class: 'ibtn', title: 'Delete rule', 'aria-label': 'Delete rule', onclick: () => confirm(`Delete "${r.name}"?`) && act('/api/autopilot/rule/delete', { id: r.id }, 'Rule deleted') }, '×')),
      h('div', { class: 'ap-row ap-meta' },
        h('span', { class: 'pill violet' }, `◷ ${scheduleText(r.schedule)}`),
        h('span', { class: 'pill' }, secName(r.section)),
        next && h('span', { class: 'ap-next' }, `Next ${next}`),
        !r.enabled && h('span', { class: 'muted small' }, 'Off'),
        r.enabled && AP.paused && h('span', { class: 'muted small' }, 'Paused')),
      h('div', { class: 'ap-row ap-last' },
        statusPill(r),
        r.lastRunAt && h('span', { class: 'muted small' }, agoText(r.lastRunAt)),
        h('span', { class: 'ap-result', title: r.lastResult || '' }, r.lastResult || (r.lastRunAt ? '' : 'Waiting for its first run'))),
      r.lastSkip && !r.running && Date.now() - new Date(r.lastSkip.at) < 3600_000 && h('div', { class: 'muted small' }, `Skipped ${agoText(r.lastSkip.at)}: ${r.lastSkip.reason}`),
      cmd && cmd.running && typeof liveFeed === 'function' && liveFeed(cmd));
  }

  function listView() {
    const rules = AP?.rules || [];
    return [
      killSwitch(),
      h('div', { class: 'ap-list' }, rules.length ? rules.map(card) : h('div', { class: 'empty' }, 'No rules yet. Add one from a template.')),
      h('div', { class: 'ap-foot' },
        h('button', { class: 'btn go', onclick: () => { view = 'pick'; paint(); } }, '＋ New rule'),
        h('span', { class: 'muted small' }, 'Each run shows in its section\'s live feed. Rules marked ⚠ act outside the app; the rest are read-only.')),
    ];
  }

  function pickView() {
    return [
      h('div', { class: 'ap-sub' }, h('button', { class: 'btn sm ghost', onclick: () => { view = 'list'; paint(); } }, '‹ Back'), h('b', {}, 'Pick a starting point')),
      h('div', { class: 'ap-tpls' },
        (AP?.templates || []).map((t) => h('button', {
          class: 'ap-tpl', onclick: async () => {
            const s = await act('/api/autopilot/rule/add', { template: t.id }, `${t.name} added (off)`);
            if (s) { view = 'edit'; editId = s.added; paint(); }
          },
        },
        h('div', { class: 'ap-row' }, h('b', {}, t.name), h('span', { class: 'spacer' }), t.outward ? h('span', { class: 'pill red' }, '⚠ Acts outside') : h('span', { class: 'pill green' }, 'Read-only')),
        h('div', { class: 'ap-row' }, h('span', { class: 'pill violet' }, `◷ ${scheduleText(t.schedule)}`), h('span', { class: 'pill' }, secName(t.section))),
        h('div', { class: 'muted small ap-clamp' }, t.prompt))),
        h('button', {
          class: 'ap-tpl blank', onclick: async () => {
            const s = await act('/api/autopilot/rule/add', { template: 'blank' });
            if (s) { view = 'edit'; editId = s.added; paint(); }
          },
        }, h('b', {}, '＋ Blank rule'), h('div', { class: 'muted small' }, 'Write your own prompt and schedule.'))),
    ];
  }

  function editView() {
    const r = (AP?.rules || []).find((x) => x.id === editId);
    if (!r) { view = 'list'; return listView(); }
    const s = r.schedule || {};
    const kind = s.at ? 'at' : 'every';
    const f = {
      name: h('input', { class: 'ap-in', value: r.name, maxlength: 60 }),
      section: h('select', { class: 'ap-in' }, sections().map((id) => h('option', { value: id, selected: id === r.section }, secName(id)))),
      prompt: h('textarea', { class: 'ap-in ap-prompt', rows: 9, maxlength: 4000 }),
      kind: h('select', { class: 'ap-in' }, h('option', { value: 'every', selected: kind === 'every' }, 'Every N minutes'), h('option', { value: 'at', selected: kind === 'at' }, 'At a time of day')),
      every: h('input', { class: 'ap-in sm', type: 'number', min: 1, max: 10080, value: s.everyMinutes || 60 }),
      at: h('input', { class: 'ap-in sm', type: 'time', value: s.at || '10:00' }),
      from: h('input', { class: 'ap-in sm', type: 'number', min: 0, max: 23, placeholder: 'any', value: s.fromHour ?? '' }),
      to: h('input', { class: 'ap-in sm', type: 'number', min: 1, max: 24, placeholder: 'any', value: s.toHour ?? '' }),
      outward: h('input', { type: 'checkbox', checked: !!r.outward }),
    };
    f.prompt.value = r.prompt || '';
    const chosen = new Set(s.days?.length ? s.days : s.at ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]);
    const dayBox = h('div', { class: 'ap-days' }, [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const b = h('button', { type: 'button', class: `ap-day ${chosen.has(d) ? 'on' : ''}`, 'aria-pressed': chosen.has(d) ? 'true' : 'false', onclick: () => { chosen.has(d) ? chosen.delete(d) : chosen.add(d); b.classList.toggle('on'); b.setAttribute('aria-pressed', chosen.has(d)); } }, DAY[d].slice(0, 2));
      return b;
    }));
    const everyRow = h('div', { class: 'ap-row ap-sched' }, h('span', {}, 'Every'), f.every, h('span', {}, 'min, between'), f.from, h('span', {}, 'and'), f.to, h('span', { class: 'muted small' }, 'h'));
    const atRow = h('div', { class: 'ap-row ap-sched' }, h('span', {}, 'At'), f.at);
    const sync = () => { everyRow.hidden = f.kind.value !== 'every'; atRow.hidden = f.kind.value !== 'at'; };
    f.kind.onchange = sync;
    sync();
    async function saveIt() {
      const schedule = f.kind.value === 'at'
        ? { at: f.at.value, days: [...chosen] }
        : { everyMinutes: Number(f.every.value), days: [...chosen], fromHour: f.from.value === '' ? null : Number(f.from.value), toHour: f.to.value === '' ? null : Number(f.to.value) };
      const outward = f.outward.checked;
      const confirmOut = outward && !r.outward && r.enabled ? confirm(OUTWARD_WARN({ ...r, name: f.name.value })) : false;
      if (outward && !r.outward && r.enabled && !confirmOut) return;
      const ok = await act('/api/autopilot/rule/save', { id: r.id, name: f.name.value, section: f.section.value, prompt: f.prompt.value, schedule, outward, confirm: confirmOut }, 'Rule saved');
      if (ok) { view = 'list'; paint(); }
    }
    return [
      h('div', { class: 'ap-sub' }, h('button', { class: 'btn sm ghost', onclick: () => { view = 'list'; paint(); } }, '‹ Back'), h('b', {}, `Edit · ${r.name}`), r.enabled ? h('span', { class: 'pill green' }, 'On') : h('span', { class: 'pill' }, 'Off')),
      h('div', { class: 'ap-form' },
        h('label', {}, h('span', {}, 'Name'), f.name),
        h('label', {}, h('span', {}, 'Section'), f.section),
        h('label', { class: 'full' }, h('span', {}, 'What the AI does (say exactly what is allowed; everything else stays read-only)'), f.prompt),
        h('label', {}, h('span', {}, 'Schedule'), f.kind),
        h('div', { class: 'ap-field' }, h('span', {}, 'Days'), dayBox),
        h('div', { class: 'full' }, everyRow, atRow),
        h('label', { class: 'full ap-check' }, f.outward, h('span', {}, h('b', {}, 'Acts outside the app'), h('span', { class: 'muted small' }, ' — approves, merges, comments, sends or creates things. Off means read-only, enforced in the prompt.')))),
      h('div', { class: 'ap-foot' },
        h('button', { class: 'btn go', onclick: saveIt }, 'Save'),
        h('button', { class: 'btn ghost', onclick: () => { view = 'list'; paint(); } }, 'Cancel'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm ghost', onclick: () => confirm(`Delete "${r.name}"?`) && act('/api/autopilot/rule/delete', { id: r.id }, 'Rule deleted').then(() => { view = 'list'; paint(); }) }, 'Delete rule')),
    ];
  }

  function paint() {
    if (!isOpen) return;
    const ov = HQ.overlay(OV);
    const body = !AP ? [h('div', { class: 'empty' }, 'Loading…')] : view === 'pick' ? pickView() : view === 'edit' ? editView() : listView();
    ov.replaceChildren(h('div', { class: 'ap-box', role: 'dialog', 'aria-label': 'Autopilot' },
      h('div', { class: 'ap-head' },
        h('h2', { class: 'ap-title' }, '🤖 Autopilot'),
        h('span', { class: 'muted small' }, 'Standing rules the AI runs for you'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'ibtn', title: 'Close', 'aria-label': 'Close', onclick: close }, '×')),
      ...body));
  }

  /* ---------- Header button + indicator ---------- */
  let btn = null, ind = null;
  function renderIndicator() {
    const a = AP || D?.ext?.autopilot;
    if (!ind) return;
    const n = a?.enabledCount || 0;
    ind.hidden = !n && !a?.paused;
    ind.className = `pill ap-ind ${a?.paused ? 'paused' : 'on'} ${a?.running ? 'busy' : ''}`;
    ind.textContent = a?.paused ? 'AUTOPILOT PAUSED' : `AUTOPILOT ON · ${n} rule${n === 1 ? '' : 's'}`;
  }
  btn = HQ.addButton({ id: 'btn-autopilot', label: '🤖 Autopilot', title: 'Standing rules the AI runs on a schedule', onclick: open });
  ind = h('button', { class: 'pill ap-ind', hidden: true, title: 'Open Autopilot', onclick: open });
  btn.after(ind);
  HQ.onRender(() => {
    if (D?.ext?.autopilot) AP = D.ext.autopilot;
    renderIndicator();
    if (isOpen && view === 'list') paint(); // live feeds of running rules update with the page
  });
})();
