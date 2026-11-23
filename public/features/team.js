/* Team: AI teammates (server: src/features/team.js). A full view with one card per member and a detail
   pane (report, needs-you, queue, owned Autopilot rules, scorecard, history, feedback, settings).
   Also provides: window.openTeam(id), window.teamHomeCard() for Home, and window.teamQuestionCards()
   for the AI chat, where teammates' questions wait with an answer box. Approvals live in Signals.
   Uses page globals: h, $, post, toast, HQ, D, PANEL_MODE. */
(() => {
  const OV = 'team-ov';
  let T = null, sel = null, editing = null, hiring = null, queueFor = {}, pollT = null;
  const ic = (n, f) => (window.icon ? window.icon(n) : f);
  const ago = (d) => { if (!d) return ''; const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const until = (d) => { if (!d) return ''; const m = Math.round((new Date(d) - Date.now()) / 60000); return m <= 0 ? 'now' : m < 60 ? `in ${m} min` : m < 1440 ? `in ${Math.round(m / 60)} h` : new Date(d).toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
  const STATUS = { working: ['Working', 'green'], idle: ['Idle', ''], blocked: ['Blocked', 'red'], failed: ['Last shift failed', 'amber'], off: ['Off', 'grey'] };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const avatar = (m, size = 'md') => h('span', { class: `tm-av ${size}`, style: `--c:${m.color || '#6d5efc'}`, 'aria-hidden': 'true' }, m.emoji || m.name?.[0] || '?');
  const KEY = /^[A-Z][A-Z0-9]+-\d+$/;
  const lvChip = (lv) => (lv ? h('span', { class: `tm-lv l${lv.level || 1}`, title: `Level ${lv.level} · ${lv.title}` }, `Lv ${lv.level || 1}`) : null);

  async function load() {
    try { T = await (await fetch('/api/team')).json(); } catch (e) { return; }
    badge();
    if (!$(OV)?.hidden && !editing && !hiring) paint(); // never rebuild a form or interview under the cursor
    window.aibRepaint?.();
    window.dispatchEvent(new Event('team:changed'));
    try { window.renderPhone?.(); } catch (e) { /* phone not ready */ }
  }
  // The AI orb shows how many teammates' questions are waiting.
  function badge() {
    const fab = $('aib-fab');
    if (!fab) return;
    let b = fab.querySelector('.tm-qbadge');
    const n = T?.totals?.questions || 0;
    if (!b) { b = h('span', { class: 'tm-qbadge', title: 'Teammates have questions for you' }); fab.append(b); }
    b.textContent = n; b.hidden = !n;
  }

  /* ---------- Questions in the AI chat ---------- */
  window.teamQuestionCards = () => (T?.questions || []).map((q) => {
    const ta = h('textarea', { class: 'tm-ans', rows: 2, placeholder: `Answer ${q.member?.name || 'them'}… (Enter to send)`,
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } });
    async function send() {
      const answer = ta.value.trim();
      if (!answer) return;
      try { await post('/api/team/resolve', { id: q.id, decision: 'answer', answer }); toast(`Sent to ${q.member?.name || 'your teammate'}: they pick it up in a minute`); load(); } catch (e) { toast(e.message); }
    }
    return h('div', { class: 'tm-q' },
      h('div', { class: 'tm-q-h' }, q.member ? avatar(q.member, 'sm') : null, h('b', {}, `${q.member?.name || 'A teammate'} asks`), h('span', { class: 'muted small' }, ago(q.createdAt)),
        q.url ? h('a', { class: 'link small', href: q.url }, q.key || 'Open') : q.key ? h('span', { class: 'chip sm' }, q.key) : null),
      h('div', { class: 'tm-q-t' }, q.title),
      h('div', { class: 'tm-q-row' }, ta, h('button', { class: 'btn sm go', onclick: send }, 'Answer')));
  });

  /* ---------- Team line on Signals messages: who owns this ticket and what happens next ---------- */
  const ST_LABEL = { asking: ['Needs your OK', 'amber'], working: ['On it', 'green'], waiting: ['Off', 'grey'], doing: ['Doing it', 'green'], none: ['No action needed', ''], watching: ['Watching', ''] };
  window.teamLineFor = (text) => {
    const keys = [...new Set(String(text).match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [])];
    const k = keys.find((x) => T?.keys?.[x]);
    if (!k) return null;
    const s = T.keys[k];
    const [label, cls] = ST_LABEL[s.status] || ST_LABEL.watching;
    const approval = s.asks.find((a) => a.kind === 'approval');
    return h('div', { class: `tm-line ${s.status}` },
      h('div', { class: 'tm-line-h' }, avatar(s.member, 'sm'), h('b', {}, s.member.name), h('span', { class: `pill ${cls}` }, label),
        s.status === 'doing' ? h('span', { class: 'muted small' }, 'allowed without asking') : null),
      h('div', { class: 'small' }, s.text),
      h('div', { class: 'tm-line-a' },
        s.status === 'waiting' || s.status === 'watching' || s.status === 'none'
          ? h('button', { class: 'btn sm', onclick: async () => { try { const r = await post('/api/team/followup', { key: k }); toast(r.queued ? `${r.member} will look right after the current shift` : `${r.member} is following up on ${k}`); load(); } catch (e) { toast(e.message); } } }, s.status === 'none' ? `Ask ${s.member.name} to look again` : `Let ${s.member.name} follow up`)
          : null,
        approval ? h('button', { class: 'btn sm go', onclick: async () => { try { await post('/api/team/resolve', { id: approval.id, decision: 'approve' }); toast(`Approved · ${s.member.name} is doing it now`); load(); } catch (e) { toast(e.message); } } }, 'Approve') : null,
        approval ? h('button', { class: 'btn sm ghost', onclick: () => window.openTeam(s.member.id) }, 'Details') : null));
  };

  /* ---------- Growth & HR → AI team: levels, the path up, Ariadne's reviews, what each one learned ---------- */
  window.teamGrowth = () => {
    if (!T) { load(); return h('div', { class: 'muted' }, 'Loading your team…'); }
    const R = T.recruiter || {};
    const xpNeed = (lv) => (lv.next ? Math.max(0, lv.next.xp - lv.xp) : 0);
    const ladderInfo = h('section', { class: 'gr-rules' },
      h('div', { class: 'gr-rules-h' }, h('h3', {}, 'How teammates level up'),
        h('button', { class: 'btn sm', disabled: !!R.reviewing, onclick: () => act('/api/team/review', {}, 'Ariadne is reviewing the team (about a minute)').then(() => window.dispatchEvent(new Event('team:changed'))) }, R.reviewing ? 'Ariadne is reviewing…' : '🧭 Ask Ariadne to review now')),
      h('div', { class: 'gr-ladder' }, (T.levels || []).map((l) => h('div', { class: 'gr-step' }, h('span', { class: `tm-lv l${l.level}` }, `Lv ${l.level}`), h('b', {}, l.title), h('small', { class: 'muted' }, `${l.xp} XP`)))),
      h('p', { class: 'small muted' }, 'XP: +10 per good shift, +4 per item finished, +8 per suggestion you approve, +6 per question you answer, +15 per 👍, +5 per lesson learned. −6 per failed shift, −4 per decline, −10 per 👎. ',
        'A promotion also needs quality: 80%+ of the last 20 shifts succeeded (at least 3), you approved 60%+ of its suggestions, and at least as many 👍 as 👎. Ariadne reviews each weekday and suggests promotions in Signals; you decide.'),
      R.last ? h('p', { class: 'small' }, h('b', {}, `Last review ${new Date(R.last.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: `), R.last.summary || '') : null);
    const cards = (T.members || []).map((m) => {
      const lv = m.lv || {};
      const sc = m.score || {};
      const gates = lv.gates || [];
      const met = gates.filter((g) => g.ok).length;
      const todo = lv.next ? [
        xpNeed(lv) ? `Earn ${xpNeed(lv)} more XP (about ${Math.ceil(xpNeed(lv) / 18)} good shift${Math.ceil(xpNeed(lv) / 18) === 1 ? '' : 's'} with finished work)` : null,
        ...gates.slice(1).filter((g) => !g.ok).map((g) => g.text),
      ].filter(Boolean) : [];
      return h('section', { class: 'gr-card' },
        h('div', { class: 'gr-head' }, avatar(m, 'lg'),
          h('div', { class: 'gr-hn' }, h('h3', {}, m.name, lvChip(lv), h('span', { class: 'muted small' }, lv.title || '')), h('div', { class: 'muted' }, m.role), h('p', { class: 'tm-charter' }, m.charter)),
          h('button', { class: 'btn sm ghost', onclick: () => window.openTeam(m.id) }, 'Open')),
        h('div', { class: 'gr-cols' },
          h('div', { class: 'gr-col' },
            h('h4', {}, lv.next ? `Path to Level ${lv.next.level} · ${lv.next.title}` : 'Top level reached'),
            lv.next ? h('div', { class: 'tm-xpbar', title: `${lv.xp} of ${lv.next.xp} XP` }, h('i', { style: `width:${Math.round((lv.progress || 0) * 100)}%` })) : null,
            lv.next ? h('div', { class: 'small muted' }, `${lv.xp} of ${lv.next.xp} XP · ${met} of ${gates.length} goals met`) : null,
            h('ul', { class: 'tm-gates' }, gates.map((g) => h('li', { class: g.ok ? 'ok' : '' }, g.ok ? '✓ ' : '○ ', g.text))),
            todo.length ? h('div', { class: 'gr-todo' }, h('b', { class: 'small' }, 'To get there'), h('ul', {}, todo.map((t) => h('li', { class: 'small' }, t)))) : lv.next ? h('div', { class: 'pill violet' }, lv.pending ? '🧭 Promotion suggested: see Signals' : 'Ready: Ariadne will review') : null),
          h('div', { class: 'gr-col' },
            h('h4', {}, '🧭 Ariadne’s review'),
            lv.coaching ? h('p', { class: 'small' }, h('b', {}, 'Coaching: '), lv.coaching.text) : h('p', { class: 'small muted' }, 'No review yet.'),
            (lv.reviews || []).slice(0, 3).map((r) => h('div', { class: 'gr-rev small' }, h('span', { class: 'muted' }, new Date(r.at).toLocaleDateString([], { month: 'short', day: 'numeric' }), r.promote ? ' · recommended a promotion' : ''),
              r.learned ? h('div', {}, h('b', {}, 'Learned: '), r.learned) : null, r.reason && r.promote ? h('div', {}, r.reason) : null)),
            (lv.promotions || []).length ? h('div', { class: 'small muted' }, lv.promotions.map((p) => `Promoted to Level ${p.to} · ${p.title} on ${new Date(p.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}`).join(' · ')) : null),
          h('div', { class: 'gr-col' },
            h('h4', {}, 'What it learned'),
            (lv.learned || []).length ? h('ul', { class: 'gr-learn' }, lv.learned.slice(0, 6).map((l) => h('li', { class: 'small' }, l.text, h('span', { class: 'muted' }, ` · ${l.from === 'self' ? 'its own lesson' : `from ${l.from}`}, ${new Date(l.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}`))))
              : h('p', { class: 'small muted' }, 'No lessons yet. It records one after a shift when something worked or should change, and your 👎 corrections land here too.'),
            h('button', { class: 'btn sm', onclick: async () => { const note = await askText(`Teach ${m.name} something`, { hint: 'It reads this every shift.', ok: 'Save lesson' }); if (note && note.trim()) act('/api/team/feedback', { id: m.id, up: false, note, teach: true }, 'Lesson saved'); } }, 'Teach a lesson'))),
        h('div', { class: 'tm-strip' },
          [[sc.shifts, 'shifts this week'], [sc.okRate != null ? `${sc.okRate}%` : '—', 'succeeded'], [sc.done, 'items done'], [sc.approveRate != null ? `${sc.approveRate}%` : '—', 'of asks approved'], [`👍 ${sc.feedback?.up || 0} · 👎 ${sc.feedback?.down || 0}`, 'feedback'], [`$${sc.costWeek ?? 0}`, 'cost this week']]
            .map(([v, l]) => h('div', { class: 'tm-kpi' }, h('b', {}, v ?? '—'), h('small', {}, l)))));
    });
    return h('div', { class: 'gr-team' }, ladderInfo, ...cards);
  };

  /* ---------- Home card ---------- */
  window.teamHomeCard = (close) => {
    const t = T || (D?.ext?.team ? { members: D.ext.team.members, totals: D.ext.team.totals } : null);
    const open = (id) => () => { close?.(); window.openTeam(id); };
    const head = h('button', { class: 'linkbtn', onclick: open(null) }, 'Open Team');
    const card = (body, extra) => h('section', { class: 'hm-card hm-span3 tm-home' }, h('div', { class: 'hm-ch' }, h('h3', {}, 'Team'), extra || null, head), body);
    if (!t) return card(h('div', { class: 'muted' }, 'Loading your team…'));
    const on = t.members.filter((m) => m.status !== 'off' || m.report?.summary || m.summary || m.needsYou);
    if (!on.length) return card(h('div', { class: 'tm-empty' }, h('p', {}, 'Your AI teammates are set up but switched off.'), h('button', { class: 'btn sm primary', onclick: open(null) }, 'Meet your team')));
    const tt = t.totals || {};
    const strip = h('div', { class: 'tm-strip' },
      [['Working', tt.working, 'green'], ['Blocked items', tt.blocked, tt.blocked ? 'red' : ''], ['Need your OK', tt.approvals, tt.approvals ? 'amber' : ''], ['Questions', tt.questions, tt.questions ? 'amber' : ''], ['Done this week', tt.doneWeek, ''], ['Cost this week', tt.costWeek != null ? `$${tt.costWeek}` : '—', '']]
        .map(([l, v, c]) => h('div', { class: `tm-kpi ${c}` }, h('b', {}, v ?? 0), h('small', {}, l))));
    const rows = h('div', { class: 'tm-hrows' }, t.members.map((m) => {
      const [label, cls] = STATUS[m.status] || STATUS.idle;
      return h('button', { class: `tm-hrow ${m.status}`, onclick: open(m.id) },
        avatar(m, 'sm'),
        h('span', { class: 'tm-hn' }, h('b', {}, m.name, ' ', m.level ? h('span', { class: `tm-lv l${m.level}` }, `Lv ${m.level}`) : m.lv ? lvChip(m.lv) : null), h('small', { class: 'muted' }, m.role)),
        h('span', { class: `pill ${cls}` }, m.status === 'working' ? h('span', { class: 'tm-pulse' }) : null, label),
        h('span', { class: 'tm-hs muted small' }, (m.report?.summary || m.summary) || (m.status === 'off' ? 'Switched off' : 'No shift yet')),
        m.needsYou ? h('span', { class: 'pill amber' }, `${m.needsYou} need you`) : null,
        (m.report?.blocked?.length || m.blocked) ? h('span', { class: 'pill red' }, `${m.report?.blocked?.length || m.blocked} blocked`) : null);
    }));
    return card(h('div', { class: 'tm-hbody' }, strip, rows), tt.needsYou ? h('button', { class: 'btn sm', onclick: () => { close?.(); window.openPhone ? window.openPhone() : $('btn-phone')?.click(); } }, `${tt.needsYou} waiting on you`) : null);
  };

  /* ---------- Full view ---------- */
  window.openTeam = async (id) => {
    HQ.overlay(OV).hidden = false;
    document.documentElement.classList.add('aic-open');
    window.syncNav?.();
    if (id) { sel = id; editing = null; }
    paint();
    await load();
    if (!sel && T?.members?.length) { sel = T.members[0].id; paint(); }
    clearInterval(pollT);
    pollT = setInterval(() => { if ($(OV)?.hidden) return clearInterval(pollT); load(); }, 8000);
  };
  const close = () => { HQ.closeOverlay(OV); document.documentElement.classList.remove('aic-open'); clearInterval(pollT); window.syncNav?.(); };

  async function act(url, body, msg) {
    try { const r = await post(url, body); if (msg) toast(msg); await load(); return r; } catch (e) { toast(e.message); return null; }
  }

  function list() {
    const R = T?.recruiter || {};
    const recruiter = h('div', { class: 'tm-rec' },
      h('div', { class: 'tm-card-h' }, h('span', { class: 'tm-av md', style: '--c:#b7791f' }, '🧭'),
        h('span', { class: 'tm-cn' }, h('b', {}, 'Ariadne'), h('small', { class: 'muted' }, 'Recruiter · hires and promotes'))),
      h('div', { class: 'small muted' }, R.reviewing ? 'Reviewing the team…' : R.last ? `Last review ${ago(R.last.at)}: ${R.last.summary || ''}` : 'Watches how everyone does and suggests promotions in Signals.'),
      R.eligible?.length ? h('div', { class: 'small' }, `Ready to level up: ${R.eligible.join(', ')}`) : null,
      h('div', { class: 'tm-rec-a' },
        h('button', { class: 'btn sm', disabled: !!R.reviewing, onclick: () => act('/api/team/review', {}, 'Ariadne is reviewing the team (about a minute)') }, R.reviewing ? 'Reviewing…' : 'Review the team'),
        h('button', { class: 'btn sm ghost', onclick: () => { editing = null; hiring = newHire(); paint(); } }, 'Hire')));
    return h('div', { class: 'tm-list' },
      recruiter,
      (T?.members || []).map((m) => {
        const [label, cls] = STATUS[m.status] || STATUS.idle;
        return h('button', { class: `tm-card ${sel === m.id ? 'on' : ''} ${m.status}`, onclick: () => { sel = m.id; editing = null; hiring = null; paint(); } },
          h('div', { class: 'tm-card-h' }, avatar(m), h('span', { class: 'tm-cn' }, h('b', {}, m.name, ' ', lvChip(m.lv)), h('small', { class: 'muted' }, `${m.role}${m.lv ? ` · ${m.lv.title}` : ''}`)),
            h('span', { class: `pill ${cls} tm-onoff`, role: 'switch', 'aria-checked': m.enabled ? 'true' : 'false', tabindex: 0,
              title: m.enabled ? `${m.name} works on its schedule. Click to switch off.` : `Click to switch ${m.name} on: it starts working on its schedule.`,
              onclick: (e) => { e.stopPropagation(); act('/api/team/member/toggle', { id: m.id, enabled: !m.enabled }, m.enabled ? `${m.name} is off` : `${m.name} is on the schedule`); },
              onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); } } },
              m.status === 'working' ? h('span', { class: 'tm-pulse' }) : null, m.enabled ? label : 'Off · turn on')),
          h('div', { class: 'tm-card-s small' }, m.report?.summary || (m.enabled ? 'Waiting for its first shift' : 'Switched off')),
          h('div', { class: 'tm-card-f small muted' },
            m.lv?.pending ? h('span', { class: 'pill violet' }, '🧭 Promotion suggested') : m.lv?.eligible ? h('span', { class: 'pill violet' }, 'Ready to level up') : null,
            m.needsYou ? h('span', { class: 'pill amber' }, `${m.needsYou} need you`) : null,
            m.report?.blocked?.length ? h('span', { class: 'pill red' }, `${m.report.blocked.length} blocked`) : null,
            m.report?.working?.length ? h('span', {}, `${m.report.working.length} in progress`) : null,
            m.nextShiftAt ? h('span', {}, `next ${until(m.nextShiftAt)}`) : null));
      }),
      h('button', { class: 'tm-add', onclick: () => { editing = null; hiring = newHire(); paint(); } }, '🧭 Hire with Ariadne, the recruiter'),
      h('button', { class: 'tm-add tm-add-form', onclick: () => { hiring = null; editing = { new: true, name: '', emoji: '✦', role: '', charter: '', playbook: '', queue: [{ kind: 'text', label: '', query: '' }], schedule: { everyMinutes: 120, days: [1, 2, 3, 4, 5], fromHour: 9, toHour: 18 }, autonomy: 'draft', budgetUsd: 5, rules: [], allowed: [] }; paint(); } }, '＋ Fill in the form myself'));
  }

  const sec = (title, body, extra) => (body ? h('section', { class: 'tm-sec' }, h('div', { class: 'tm-sec-h' }, h('h4', {}, title), extra || null), body) : null);
  const keyEl = (k, url) => (KEY.test(k || '') ? h('a', { class: 'link', href: url || '#', 'data-why-key': k }, k) : k ? (url ? h('a', { class: 'link', href: url }, k) : h('b', {}, k)) : null);

  function detail(m) {
    const [label, cls] = STATUS[m.status] || STATUS.idle;
    const r = m.report || {};
    const sc = m.score || {};
    const open = (m.inbox || []).filter((i) => i.status === 'open');
    const head = h('div', { class: 'tm-dh' }, avatar(m, 'lg'),
      h('div', { class: 'tm-dn' }, h('h3', {}, m.name, lvChip(m.lv), h('span', { class: `pill ${cls}` }, m.status === 'working' ? h('span', { class: 'tm-pulse' }) : null, label)),
        h('div', { class: 'muted' }, `${m.role}${m.lv ? ` · ${m.lv.title}` : ''}`),
        m.charter ? h('p', { class: 'tm-charter' }, m.charter) : null,
        h('div', { class: 'muted small' }, [
          m.lastShiftAt && `Last shift ${ago(m.lastShiftAt)}`, m.nextShiftAt && `next ${until(m.nextShiftAt)}`,
          T.autonomy?.[m.autonomy]?.split(':')[0], `${m.shiftsToday ?? 0} of ${m.maxShifts ?? 8} shifts today`, T.billing === 'plan' ? `≈$${sc.spentToday ?? 0} of plan usage today (not billed)` : `$${sc.spentToday ?? 0} of $${m.budgetUsd} today`].filter(Boolean).join(' · '))),
      h('div', { class: 'tm-dacts' },
        m.running ? h('button', { class: 'btn sm', onclick: () => act('/api/team/stop', { id: m.id }, 'Stopping') }, '■ Stop')
          : h('button', { class: 'btn sm primary', onclick: () => act('/api/team/shift', { id: m.id }, `${m.name} started a shift: watch it in the Activity log`) }, '▶ Run a shift now'),
        h('label', { class: 'tm-sw', title: m.enabled ? 'On: works on its schedule' : 'Off: only works when you press Run' },
          h('input', { type: 'checkbox', checked: !!m.enabled, onchange: (e) => act('/api/team/member/toggle', { id: m.id, enabled: e.target.checked }, e.target.checked ? `${m.name} is on the schedule` : `${m.name} is off`) }), h('span', {}, 'On schedule')),
        h('button', { class: 'btn sm ghost', onclick: () => { editing = JSON.parse(JSON.stringify(m)); paint(); } }, 'Edit'),
        h('button', { class: 'btn sm ghost', title: `Chat with ${m.name}`, onclick: () => window.askAIBubble?.({ text: `${m.name} (${m.role}) — charter: ${m.charter}. Last report: ${r.summary || 'none'}`, label: m.name }, `@${m.name} `) }, '✦ Ask')));
    const skip = m.lastSkip ? h('div', { class: 'blocked small' }, `Skipped ${ago(m.lastSkip.at)}: ${m.lastSkip.reason}`) : null;
    const lv = m.lv;
    const level = lv ? h('section', { class: 'tm-sec tm-level' },
      h('div', { class: 'tm-sec-h' }, h('h4', {}, `Level ${lv.level} · ${lv.title}`), h('span', { class: 'muted small' }, `${lv.xp} XP`),
        lv.pending ? h('span', { class: 'pill violet' }, '🧭 Ariadne suggested a promotion: see Signals') : lv.eligible ? h('span', { class: 'pill violet' }, 'Ready to level up: Ariadne will review') : null),
      lv.next ? h('div', { class: 'tm-xpbar', title: `${Math.round(lv.progress * 100)}% to Level ${lv.next.level}` }, h('i', { style: `width:${Math.round(lv.progress * 100)}%` })) : h('div', { class: 'small muted' }, 'Top level reached.'),
      lv.next ? h('details', {}, h('summary', { class: 'small muted' }, `What it takes to reach Level ${lv.next.level} · ${lv.next.title}`),
        h('ul', { class: 'tm-gates' }, lv.gates.map((g) => h('li', { class: g.ok ? 'ok' : '' }, g.ok ? '✓ ' : '○ ', g.text))),
        h('div', { class: 'small muted' }, 'XP: +10 per good shift, +4 per item done, +8 per suggestion you approve, +6 per question answered, +15 per 👍, +5 per lesson learned; −6 failed shift, −4 decline, −10 per 👎.')) : null,
      lv.coaching ? h('div', { class: 'tm-coach small' }, h('span', {}, '🧭'), h('span', {}, h('b', {}, 'Ariadne: '), lv.coaching.text)) : null,
      lv.promotions?.length ? h('div', { class: 'small muted' }, lv.promotions.map((p) => `Promoted to Level ${p.to} · ${p.title} ${ago(p.at)}`).join(' · ')) : null) : null;
    const charter = null;
    const needs = open.length ? sec(`Needs you (${open.length})`, h('div', { class: 'tm-needs' }, open.map((i) => i.kind === 'approval' || i.kind === 'promotion' || i.kind === 'wake'
      ? h('div', { class: `tm-need ${i.kind === 'promotion' ? 'promo' : ''}` }, h('div', {}, h('b', {}, i.kind === 'promotion' ? `🧭 ${i.title}` : i.title), i.detail ? h('div', { class: 'muted small' }, i.detail) : null, keyEl(i.key, i.url)),
        h('div', { class: 'tm-need-a' }, h('button', { class: 'btn sm go', onclick: () => act('/api/team/resolve', { id: i.id, decision: 'approve' }, i.kind === 'promotion' ? `${m.name} was promoted 🎉` : `Approved · ${m.name} is doing it now`) }, i.kind === 'promotion' ? 'Promote' : i.kind === 'wake' ? 'Let it follow up' : i.reply ? 'Send' : 'Approve'),
          i.reply ? h('button', { class: 'btn sm', onclick: async () => { const t = await askText('Edit the reply, then send it as you', { value: i.detail || '', ok: 'Send' }); if (t && t.trim()) act('/api/team/resolve', { id: i.id, decision: 'approve', text: t.trim() }, 'Sending your reply'); } }, 'Edit') : null,
          h('button', { class: 'btn sm ghost', onclick: async () => { const note = await askText('Decline. Why? (optional)', { hint: 'They read it next shift.', ok: 'Decline' }); if (note !== null) act('/api/team/resolve', { id: i.id, decision: 'decline', note }, 'Declined'); } }, 'Decline')))
      : h('div', { class: 'tm-need q' }, h('div', {}, h('b', {}, `Question: ${i.title}`), keyEl(i.key, i.url)),
        h('div', { class: 'tm-need-a' }, h('button', { class: 'btn sm', onclick: () => { window.askAIBubble ? window.askAIBubble({ text: `${m.name} asks: ${i.title}`, label: m.name }) : null; } }, 'Answer in chat')))))) : null;
    const listOf = (items, fn) => (items?.length ? h('ul', { class: 'tm-ul' }, items.map(fn)) : null);
    const now = sec('In progress', listOf(r.working, (w) => h('li', {}, keyEl(w.key, w.url), ' ', w.title || '', w.status ? h('span', { class: 'muted' }, ` — ${w.status}`) : null)));
    const blocked = sec('Blocked', listOf(r.blocked, (b) => h('li', {}, keyEl(b.key, b.url), ' ', b.text || '', b.waitingOn ? h('span', { class: 'muted' }, ` · waiting on ${b.waitingOn}`) : null)));
    const next = sec('Next shift', listOf(r.next, (x) => h('li', {}, typeof x === 'string' ? x : x.text || '')));
    const done = sec('Done last shift', listOf(r.done, (d) => h('li', {}, keyEl(d.key, d.url), ' ', d.text || '')));
    const hand = m.handoffs?.length ? sec('Handed to it', listOf(m.handoffs, (x) => h('li', {}, h('b', {}, x.from), ': ', x.key ? keyEl(x.key) : null, ' ', x.note))) : null;
    const q = queueFor[m.id];
    const queue = sec('Queue', q ? h('div', { class: 'tm-queue' }, q.map((g) => h('div', {}, h('div', { class: 'muted small' }, `${g.label} · ${g.items.length || (g.note ? 'found by the AI' : 0)}`),
      g.note ? h('div', { class: 'small' }, g.note) : null, listOf(g.items.slice(0, 12), (it) => h('li', {}, keyEl(it.key, it.url), ' ', it.title || '', it.status ? h('span', { class: 'muted' }, ` · ${it.status}`) : null)))))
      : h('button', { class: 'btn sm ghost', onclick: async () => { queueFor[m.id] = [{ label: 'Reading…', items: [], note: '' }]; paint(); queueFor[m.id] = (await (await fetch(`/api/team/queue?id=${m.id}`)).json()).queue; paint(); } }, `Show what ${m.name} owns (${(m.queue || []).map((x) => x.label).join(', ') || 'nothing mapped'})`));
    const rules = m.rulesOwned?.length ? sec('Autopilot rules it owns', listOf(m.rulesOwned, (x) => h('li', {}, h('b', {}, x.name), h('span', { class: `pill ${x.enabled ? 'green' : 'grey'}` }, x.enabled ? 'on' : 'off'), x.lastResult ? h('span', { class: 'muted small' }, ` ${ago(x.lastRunAt)}: ${x.lastResult}`) : null))) : null;
    const kpi = (v, l, c = '') => h('div', { class: `tm-kpi ${c}` }, h('b', {}, v ?? '—'), h('small', {}, l));
    const score = sec('Scorecard · last 7 days', h('div', { class: 'tm-strip' },
      kpi(sc.shifts, 'shifts'), kpi(sc.okRate != null ? `${sc.okRate}%` : '—', 'shifts succeeded'), kpi(sc.done, 'items done'),
      kpi(sc.approveRate != null ? `${sc.approveRate}%` : '—', 'of asks you approved'), kpi(`$${sc.costWeek ?? 0}`, 'cost'),
      kpi(`👍 ${sc.feedback?.up || 0} · 👎 ${sc.feedback?.down || 0}`, 'your feedback'),
      ...Object.entries(sc.metrics || {}).filter(([, v]) => v).map(([k, v]) => kpi(v, k.replace(/([A-Z])/g, ' $1').toLowerCase()))));
    const fb = sec('How did it do?', h('div', { class: 'tm-fb' },
      h('button', { class: 'btn sm', onclick: () => act('/api/team/feedback', { id: m.id, up: true }, 'Thanks noted') }, '👍 Good work'),
      h('button', { class: 'btn sm', onclick: async () => { const note = await askText(`What should ${m.name} do differently?`, { hint: 'Saved to its memory; it reads this every shift.', ok: 'Save correction' }); if (note !== null && note.trim()) act('/api/team/feedback', { id: m.id, up: false, note }, 'Correction saved'); } }, '👎 Correct it')));
    const hist = sec('Shift history', listOf(m.history, (x) => h('li', { class: x.ok ? '' : 'bad' }, h('span', { class: 'muted small' }, `${ago(x.at)} · `), x.summary,
      x.cost ? h('span', { class: 'muted small' }, ` · $${Math.round(x.cost * 100) / 100}`) : null)));
    return h('div', { class: 'tm-detail' }, head, skip, level, needs, r.failed ? h('div', { class: 'blocked small' }, `Last shift failed: ${r.summary}`) : null, now, blocked, next, done, hand, charter, queue, rules, score, fb, hist);
  }

  function editor(e) {
    const set = (k) => (ev) => { e[k] = ev.target.value; };
    const row = (label, el, hint) => h('label', { class: 'tm-f' }, h('span', {}, label), el, hint ? h('small', { class: 'muted' }, hint) : null);
    const sch = e.schedule || {};
    const mode = sch.at != null ? 'at' : 'every';
    const qrows = h('div', { class: 'tm-qrows' }, (e.queue || []).map((q, i) => h('div', { class: 'tm-qrow' },
      h('select', { onchange: (ev) => { q.kind = ev.target.value; paint(); } }, [['jql', 'Jira (JQL)'], ['github', 'GitHub PRs (gh search)'], ['projects', 'My epics this quarter'], ['text', 'Described in words']].map(([v, l]) => h('option', { value: v, selected: q.kind === v }, l))),
      h('input', { placeholder: 'Label, e.g. PRDs in QA', value: q.label || '', oninput: (ev) => { q.label = ev.target.value; } }),
      q.kind !== 'projects' ? h('input', { class: 'grow', placeholder: q.kind === 'jql' ? 'project = ABC AND status = "QA Review"' : q.kind === 'github' ? '--repo=owner/repo --state=open' : 'what work this is, in words', value: q.query || '', oninput: (ev) => { q.query = ev.target.value; } }) : h('span', { class: 'muted small grow' }, 'From Projects'),
      h('button', { class: 'ibtn', 'aria-label': 'Remove', onclick: () => { e.queue.splice(i, 1); paint(); } }, '×'))),
      h('button', { class: 'btn sm ghost', onclick: () => { e.queue.push({ kind: 'jql', label: '', query: '' }); paint(); } }, '＋ Add work'));
    const days = h('div', { class: 'tm-days' }, DAYS.map((d, i) => h('label', {}, h('input', { type: 'checkbox', checked: (sch.days || [1, 2, 3, 4, 5]).includes(i), onchange: (ev) => { const s = new Set(sch.days || [1, 2, 3, 4, 5]); ev.target.checked ? s.add(i) : s.delete(i); sch.days = [...s].sort(); } }), d)));
    const schedule = h('div', { class: 'tm-sched' },
      h('select', { onchange: (ev) => { e.schedule = ev.target.value === 'at' ? { at: '09:30', days: sch.days || [1, 2, 3, 4, 5] } : { everyMinutes: 120, days: sch.days || [1, 2, 3, 4, 5] }; paint(); } },
        h('option', { value: 'every', selected: mode === 'every' }, 'Every'), h('option', { value: 'at', selected: mode === 'at' }, 'Daily at')),
      mode === 'every' ? [h('input', { type: 'number', min: 15, step: 15, value: sch.everyMinutes || 120, oninput: (ev) => { sch.everyMinutes = Number(ev.target.value); } }), h('span', {}, 'min, from'),
        h('input', { type: 'number', min: 0, max: 23, value: sch.fromHour ?? '', placeholder: '9', oninput: (ev) => { sch.fromHour = ev.target.value; } }), h('span', {}, 'to'),
        h('input', { type: 'number', min: 1, max: 24, value: sch.toHour ?? '', placeholder: '18', oninput: (ev) => { sch.toHour = ev.target.value; } })]
        : h('input', { type: 'time', value: sch.at || '09:30', oninput: (ev) => { sch.at = ev.target.value; } }),
      days);
    const rules = h('div', { class: 'tm-rules' }, (T.rules || []).map((r) => h('label', {}, h('input', { type: 'checkbox', checked: (e.rules || []).includes(r.id), onchange: (ev) => { const s = new Set(e.rules || []); ev.target.checked ? s.add(r.id) : s.delete(r.id); e.rules = [...s]; } }), r.name, r.enabled ? '' : h('span', { class: 'muted small' }, ' (off)'))));
    async function save() {
      const r = await act('/api/team/member', { ...e, new: undefined }, e.new ? `${e.name} joined the team (off until you switch it on)` : 'Saved');
      if (r) { sel = r.id; editing = null; paint(); }
    }
    return h('div', { class: 'tm-detail tm-edit' },
      h('div', { class: 'tm-dh' }, avatar(e, 'lg'), h('h3', {}, e.new ? 'New teammate' : `Edit ${e.name}`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm ghost', onclick: () => { editing = null; paint(); } }, 'Cancel'), h('button', { class: 'btn sm primary', onclick: save }, 'Save')),
      h('div', { class: 'tm-grid2' },
        row('Name', h('input', { value: e.name, placeholder: 'e.g. Hermes', oninput: set('name') }), e.new ? 'Greek names welcome: Hermes, Artemis, Hestia, Apollo…' : null),
        row('Emoji', h('input', { value: e.emoji, maxlength: 4, oninput: set('emoji') })),
        row('Role', h('input', { value: e.role, placeholder: 'e.g. Release captain', oninput: set('role') })),
        row('Color', h('input', { type: 'color', value: e.color || '#6d5efc', oninput: set('color') }))),
      row('Charter: what it owns and what done looks like', h('textarea', { rows: 3, oninput: set('charter') }, e.charter || '')),
      row('How it works (playbook)', h('textarea', { rows: 4, oninput: set('playbook') }, e.playbook || ''), 'Name amem skills or steps to follow. Every shift reads this.'),
      row('Work it owns', qrows, 'Its queue: real items it picks up each shift.'),
      row('Schedule', schedule),
      h('div', { class: 'tm-grid2' },
        row('Shifts per day', h('input', { type: 'number', min: 1, max: 48, value: e.maxShifts ?? 8, oninput: (ev) => { e.maxShifts = Number(ev.target.value); } }), 'Its working day: after this many shifts it stops until tomorrow. Approved actions and replies still run.'),
        row('Autonomy', h('select', { onchange: (ev) => { e.autonomy = ev.target.value; paint(); } }, Object.entries(T.autonomy || {}).map(([k, v]) => h('option', { value: k, selected: e.autonomy === k }, v)))),
        row(T.billing === 'plan' ? 'Spending cap per day ($, only with an API key)' : 'Spending cap per day ($)', h('input', { type: 'number', min: 0.5, step: 0.5, value: e.budgetUsd ?? 5, oninput: (ev) => { e.budgetUsd = Number(ev.target.value); } }), T.billing === 'plan' ? 'You use a Claude subscription: runs count toward your plan, nothing is billed, so this cap is not applied.' : null)),
      e.autonomy === 'act' ? row('Actions it may take without asking (one per line)', h('textarea', { rows: 3, oninput: (ev) => { e.allowed = ev.target.value.split('\n'); } }, (e.allowed || []).join('\n')), 'e.g. "Comment on Jira tickets in my PRD queue". Everything else still asks you in Signals.') : null,
      row('Autopilot rules it owns', rules, 'They keep their own schedule; the card shows how they did.'),
      !e.new ? h('div', { class: 'tm-danger' }, h('button', { class: 'btn sm ghost', onclick: () => { if (confirm(`Remove ${e.name} from the team? Its history stays on disk.`)) act('/api/team/member/delete', { id: e.id }, `${e.name} left the team`).then(() => { sel = null; editing = null; paint(); }); } }, `Remove ${e.name}`)) : null);
  }

  /* ---------- Hire with AI: a short interview, then a drafted teammate ---------- */
  const newHire = () => ({ turns: [{ who: 'ai', text: 'Hi, I’m Ariadne, your team’s recruiter. Tell me who you need: what should this teammate take off your plate, and what would a great job look like? Plain words are perfect.' }], options: ['Review every PRD and write the test plans', 'Keep CI and flaky tests healthy', 'Chase my open bugs every morning'], pending: false, draft: null, draftName: '', error: null, input: '' });
  async function hireSend(text, finish = false) {
    const H = hiring;
    if (!H || H.pending) return;
    if (text) H.turns.push({ who: 'me', text });
    H.input = ''; H.options = []; H.pending = true; H.error = null; H.finishing = finish;
    paint();
    try {
      const r = await post('/api/team/interview', { turns: H.turns, finish });
      if (hiring !== H) return;
      if (r.draft) { H.draft = r.draft; H.draftName = r.draft.name || ''; }
      else { H.turns.push({ who: 'ai', text: r.ask }); H.options = r.options || []; }
    } catch (e) { if (hiring === H) H.error = e.message; }
    if (hiring === H) { H.pending = false; paint(); setTimeout(() => $('tm-hire-in')?.focus(), 30); }
  }
  async function hireCreate(andOn) {
    const d = hiring.draft;
    const name = String(hiring.draftName || d.name || '').trim();
    if (!name) return toast('Pick or type a name');
    const m = await act('/api/team/member', { ...d, name, names: undefined, why: undefined }, null);
    if (!m) return;
    if (andOn) await act('/api/team/member/toggle', { id: m.id, enabled: true }, null);
    toast(andOn ? `${name} joined the team and is on the schedule` : `${name} joined the team (off until you switch it on)`);
    hiring = null; sel = m.id; paint();
  }
  function hire(H) {
    const sch = (x) => (x?.at ? `Daily at ${x.at}` : x?.everyMinutes ? `Every ${x.everyMinutes >= 60 && x.everyMinutes % 60 === 0 ? `${x.everyMinutes / 60} h` : `${x.everyMinutes} min`}${x.fromHour != null ? `, ${x.fromHour}:00–${x.toHour}:00` : ''}` : '—') + (x?.days ? ` · ${x.days.map((d) => DAYS[d]).join(' ')}` : '');
    const chat = h('div', { class: 'tm-hire-chat' },
      H.turns.map((t) => h('div', { class: `tm-hmsg ${t.who}` }, t.who === 'ai' ? h('span', { class: 'tm-hai', title: 'Ariadne' }, '🧭') : null, h('div', { class: 'tm-hb' }, t.text))),
      H.pending ? h('div', { class: 'tm-hmsg ai' }, h('span', { class: 'tm-hai' }, '🧭'), h('div', { class: 'tm-hb muted pulse' }, H.draft || H.finishing ? 'Ariadne is crafting your teammate…' : 'Ariadne is thinking…')) : null,
      H.error ? h('div', { class: 'blocked small' }, H.error) : null);
    let body;
    if (H.draft) {
      const d = H.draft;
      const preview = { ...d, name: H.draftName || d.name, color: d.color };
      const rulesOwned = (d.rules || []).map((id) => (T.rules || []).find((r) => r.id === id)?.name).filter(Boolean);
      body = h('div', { class: 'tm-draft' },
        h('div', { class: 'tm-dh' }, avatar(preview, 'lg'), h('div', { class: 'tm-dn' }, h('h3', {}, preview.name || 'Name it'), h('div', { class: 'muted' }, d.role || ''))),
        d.why ? h('p', { class: 'tm-p tm-why' }, h('span', { class: 'tm-hai' }, '🧭'), h('span', {}, d.why)) : null,
        h('div', { class: 'tm-f' }, h('span', { class: 'tm-l' }, 'Name'),
          h('div', { class: 'tm-names' }, (d.names || []).map((n) => h('button', { class: `chip ${n === H.draftName ? 'on' : ''}`, onclick: () => { H.draftName = n; paint(); } }, n)),
            h('input', { class: 'tm-name-in', placeholder: 'or type your own', value: (d.names || []).includes(H.draftName) ? '' : H.draftName, oninput: (e) => { H.draftName = e.target.value; } }))),
        sec('Charter', h('p', { class: 'tm-p' }, d.charter || '—')),
        sec('How it works', h('p', { class: 'tm-p' }, d.playbook || '—')),
        sec('Work it owns', h('ul', { class: 'tm-ul' }, (d.queue || []).map((q) => h('li', {}, h('b', {}, q.label || q.kind), h('span', { class: 'muted' }, ` · ${{ jql: 'Jira', github: 'GitHub', projects: 'My epics', text: 'in words' }[q.kind] || q.kind}${q.query ? `: ${q.query}` : ''}`))))),
        h('div', { class: 'tm-strip' },
          h('div', { class: 'tm-kpi' }, h('b', {}, sch(d.schedule)), h('small', {}, 'schedule')),
          h('div', { class: 'tm-kpi' }, h('b', {}, (T.autonomy?.[d.autonomy] || 'Draft and ask').split(':')[0]), h('small', {}, 'autonomy')),
          h('div', { class: 'tm-kpi' }, h('b', {}, `$${d.budgetUsd ?? 5}`), h('small', {}, 'budget a day'))),
        d.allowed?.length ? sec('May do without asking', h('ul', { class: 'tm-ul' }, d.allowed.map((a) => h('li', {}, a)))) : null,
        rulesOwned.length ? sec('Autopilot rules it takes over', h('ul', { class: 'tm-ul' }, rulesOwned.map((n) => h('li', {}, n)))) : null,
        h('div', { class: 'tm-hire-acts' },
          h('button', { class: 'btn primary', onclick: () => hireCreate(false) }, `Create ${H.draftName || 'teammate'}`),
          h('button', { class: 'btn', title: 'Create it and put it on its schedule now', onclick: () => hireCreate(true) }, 'Create and switch on'),
          h('button', { class: 'btn ghost', onclick: () => { editing = { ...d, name: H.draftName || d.name, new: true, names: undefined, why: undefined }; hiring = null; paint(); } }, 'Tweak in the form'),
          h('button', { class: 'btn ghost', onclick: () => { H.draft = null; H.turns.push({ who: 'ai', text: 'Happy to adjust. What should be different about this candidate?' }); paint(); } }, 'Change something')));
    }
    const ta = h('textarea', { id: 'tm-hire-in', class: 'tm-hire-in', rows: 2, placeholder: H.draft ? 'Tell it what to change…' : 'Answer in your own words… (Enter to send)', oninput: (e) => { H.input = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = H.input.trim(); if (v) hireSend(v); } } }, H.input || '');
    const answered = H.turns.some((t) => t.who === 'me');
    const compose = H.draft ? null : h('div', { class: 'tm-hire-compose' },
      H.options?.length && !H.pending ? h('div', { class: 'tm-opts' }, H.options.map((o) => h('button', { class: 'chip', onclick: () => hireSend(o) }, o))) : null,
      h('div', { class: 'tm-hire-row' }, ta,
        h('button', { class: 'btn go', disabled: H.pending, onclick: () => { const v = H.input.trim(); if (v) hireSend(v); } }, 'Send')),
      answered && !H.pending ? h('button', { class: 'linkbtn small', onclick: () => hireSend('', true) }, 'That’s enough, show me the candidate') : null);
    return h('div', { class: 'tm-detail tm-hire' },
      h('div', { class: 'tm-dh' }, h('span', { class: 'tm-av lg', style: '--c:#b7791f' }, '🧭'), h('div', { class: 'tm-dn' }, h('h3', {}, 'Ariadne', h('span', { class: 'pill' }, 'Recruiter')), h('div', { class: 'muted small' }, 'Tell her who you need. A few questions in plain words, then she crafts the teammate for you to check. Nothing is saved until you press Create.')),
        h('button', { class: 'btn sm ghost', onclick: () => { hiring = null; editing = { new: true, name: '', emoji: '✦', role: '', charter: '', playbook: '', queue: [{ kind: 'text', label: '', query: '' }], schedule: { everyMinutes: 120, days: [1, 2, 3, 4, 5], fromHour: 9, toHour: 18 }, autonomy: 'draft', budgetUsd: 5, rules: [], allowed: [] }; paint(); } }, 'Fill in the form myself'),
        h('button', { class: 'btn sm ghost', onclick: () => { hiring = null; paint(); } }, 'Cancel')),
      chat, body, compose);
  }

  function paint() {
    const ov = $(OV);
    if (!ov || ov.hidden) return;
    const m = T?.members?.find((x) => x.id === sel);
    const tt = T?.totals || {};
    HQ.repaint(ov, () => h('div', { class: 'aic-box tm-box', role: 'dialog', 'aria-label': 'Team' },
      h('header', { class: 'aic-head' }, h('h2', { class: 'vh' }, ic('team', '👥'), 'Team'),
        T ? h('span', { class: 'muted small' }, `${(T.members || []).filter((x) => x.enabled).length} on · ${tt.working || 0} working · ${tt.needsYou || 0} need you · ${tt.doneWeek || 0} done this week · $${tt.costWeek || 0} this week`) : null,
        h('span', { class: 'st-gap' }),
        T ? h('button', { class: `btn sm ${T.paused ? 'primary' : 'ghost'}`, title: T.paused ? 'Resume every teammate' : 'Pause every teammate and stop running shifts', onclick: () => act('/api/team/pause', { paused: !T.paused }, T.paused ? 'Team back at work' : 'Team paused') }, T.paused ? '▶ Resume team' : '❚❚ Pause team') : null,
        h('button', { class: 'btn', onclick: close }, 'Close')),
      !T ? h('div', { class: 'empty' }, 'Loading your team…')
        : h('div', { class: 'tm-body' }, list(), hiring ? hire(hiring) : editing ? editor(editing) : m ? detail(m) : h('div', { class: 'tm-detail empty' }, 'Pick a teammate'))));
  }

  /* ---------- Wiring ---------- */
  window.HQ_VIEWCTX = window.HQ_VIEWCTX || {};
  window.HQ_VIEWCTX[OV] = () => { const m = T?.members?.find((x) => x.id === sel); return { view: 'Team', label: m ? `Team · ${m.name}` : 'Team', teammate: m ? { name: m.name, role: m.role, charter: m.charter, report: m.report, needsYou: m.inbox?.filter((i) => i.status === 'open') } : null, suggest: m ? [`What is ${m.name} stuck on?`, `Plan ${m.name}'s next shift`, `Review ${m.name}'s last report`] : ['Who on my team needs me?', 'Summarize the team’s week'] }; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $(OV) && !$(OV).hidden && !editing && !hiring) close(); });
  if (!PANEL_MODE) HQ.addButton({ id: 'btn-team', label: '👥 Team', title: 'Team: your AI teammates, what they work on and what they need from you', onclick: () => window.openTeam() });
  load();
  setInterval(load, 30_000);
})();
