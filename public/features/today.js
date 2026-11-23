/* Today, team-aware (server: GET /api/today in src/features/team.js). Three panels at the top of the Day page:
   - Your part: what only you can do, ranked, with the action right on the row.
   - Team at work: one live row per teammate (doing now, next shift, waiting items, stuck only when truly stuck).
   - Done today: everything that went out today, by you and the team, with filters.
   It also tags step rows a teammate owns and folds them into "Handled by the team (n)", and the step
   counts leave them out (window.teamOwns, used by counts() in flow.js).
   Uses page globals: h, $, post, toast, HQ, D, PANEL_MODE, askAbout, closePhone. */
(() => {
  if (PANEL_MODE) return;
  let TD = null, filter = 'all', showAll = false, pollT = null;
  const time = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const until = (d) => { if (!d) return ''; const m = Math.round((new Date(d) - Date.now()) / 60000); return m <= 0 ? 'now' : m < 60 ? `in ${m} min` : m < 1440 ? `at ${time(d)}` : new Date(d).toLocaleDateString([], { weekday: 'short' }) + ` ${time(d)}`; };
  const av = (m, cls = 'sm') => h('span', { class: `tm-av ${cls}`, style: `--c:${m?.color || '#6d5efc'}`, 'aria-hidden': 'true' }, m?.emoji || (m?.you ? '🙂' : m?.name?.[0] || '?'));
  const KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

  // Owned by a teammate? (url or text with a Jira key) → { id, name, emoji } | null
  window.teamOwns = (x) => {
    const o = TD?.owned;
    if (!o || !x) return null;
    if (o[x]) return o[x];
    for (const k of String(x).match(KEY) || []) if (o[k]) return o[k];
    return null;
  };

  let ownedSig = '';
  async function load() {
    try { TD = await (await fetch('/api/today')).json(); } catch (e) { return; }
    paint();
    // Steps refold and counts update only when what the team owns changed (a full redraw is heavier).
    const sig = JSON.stringify(Object.keys(TD.owned || {}).sort());
    if (sig !== ownedSig) { ownedSig = sig; if (typeof render === 'function' && D) { try { render(); } catch (e) { /* page not ready */ } } }
  }
  async function act(url, body, msg) { try { const r = await post(url, body); if (msg) toast(msg); load(); return r; } catch (e) { toast(e.message); return null; } }

  /* ---------- Your part ---------- */
  function actions(it) {
    const open = it.url ? h('a', { class: 'btn sm ghost', href: it.url }, 'Open') : null;
    const details = it.member ? h('button', { class: 'btn sm ghost', onclick: () => window.openTeam?.(it.member.id) }, 'Details') : null;
    switch (it.kind) {
      case 'approval': case 'promotion': case 'wake':
        return [h('button', { class: 'btn sm go', onclick: () => act('/api/team/resolve', { id: it.itemId, decision: 'approve' }, it.kind === 'promotion' ? 'Promoted 🎉' : it.kind === 'wake' ? `${it.member.name} is following up` : `Approved · ${it.member.name} is doing it now`) }, it.kind === 'promotion' ? 'Promote' : it.kind === 'wake' ? 'Let it follow up' : 'Approve'),
          h('button', { class: 'btn sm ghost', onclick: async () => { const note = await askText('Decline. Why? (optional)', { hint: 'They read it next shift.', ok: 'Decline' }); if (note !== null) act('/api/team/resolve', { id: it.itemId, decision: 'decline', note }, 'Declined'); } }, 'Decline'), details];
      case 'reply':
        return [h('button', { class: 'btn sm go', onclick: () => act('/api/team/resolve', { id: it.itemId, decision: 'approve' }, 'Sending your reply') }, 'Send'),
          h('button', { class: 'btn sm', onclick: async () => { const t = await askText('Edit the reply, then send it as you', { value: it.detail || '', ok: 'Send' }); if (t && t.trim()) act('/api/team/resolve', { id: it.itemId, decision: 'approve', text: t.trim() }, 'Sending your reply'); } }, 'Edit'), open];
      case 'question': {
        const inp = h('input', { class: 'td-ans', placeholder: 'Answer…', onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) act('/api/team/resolve', { id: it.itemId, decision: 'answer', answer: e.target.value.trim() }, `Sent to ${it.member.name}`); } });
        return [inp, h('button', { class: 'btn sm go', onclick: () => inp.value.trim() && act('/api/team/resolve', { id: it.itemId, decision: 'answer', answer: inp.value.trim() }, `Sent to ${it.member.name}`) }, 'Answer')];
      }
      case 'unblock':
        return [open, h('button', { class: 'btn sm go', title: `Tell ${it.member.name} it can move again: it starts a shift now`, onclick: () => act('/api/team/shift', { id: it.member.id }, `${it.member.name} is back at work`) }, 'Done, wake it')];
      case 'meeting':
        return [it.join && window.joinMeeting ? h('button', { class: 'btn sm go', onclick: () => window.joinMeeting({ title: it.title, start: it.start, url: it.join }) }, '📹 Join') : open, h('button', { class: 'btn sm ghost', onclick: () => $('s-meet')?.scrollIntoView({ behavior: 'smooth' }) }, 'Prep')];
      case 'reviews':
        return [h('button', { class: 'btn sm', onclick: () => $('s-github')?.scrollIntoView({ behavior: 'smooth' }) }, 'Show them')];
      case 'task':
        return [h('button', { class: 'btn sm', onclick: () => $('s-work')?.scrollIntoView({ behavior: 'smooth' }) }, 'Open task')];
      case 'message': case 'invite':
        return [h('button', { class: 'btn sm', onclick: () => ($('btn-phone') || $('phone-btn'))?.click() }, it.kind === 'invite' ? 'Answer' : 'Reply'), open,
          it.pingId ? h('button', { class: 'btn sm ghost', title: 'Handled: remove it', onclick: () => act('/api/pings/dismiss', { ids: [it.pingId] }, null) }, '✓') : null];
      default: return [open];
    }
  }
  const KIND = { unblock: ['🚧', 'Unblock'], approval: ['✅', 'Approve'], reply: ['💬', 'Reply'], question: ['❓', 'Question'], wake: ['👋', 'Follow up'], promotion: ['🧭', 'Promotion'], message: ['💬', 'Message'], invite: ['📅', 'Invite'], review: ['👀', 'Review'], reviews: ['👀', 'Reviews'], task: ['☑️', 'Task'], meeting: ['📹', 'Meeting'] };
  function yourPart() {
    const items = TD.yourPart || [];
    const head = h('div', { class: 'td-h' }, h('h3', {}, 'Your part'),
      h('span', { class: 'muted small' }, items.length ? `${items.length} thing${items.length === 1 ? '' : 's'}${TD.minutes ? ` · ~${TD.minutes} min` : ''}${TD.more ? ` · ${TD.more} more below` : ''}` : ''));
    if (!items.length) return h('div', { class: 'td-card td-you' }, head, h('div', { class: 'td-empty' }, '🎉 Nothing needs you right now. The team has the rest.'));
    return h('div', { class: 'td-card td-you' }, head, h('ol', { class: 'td-list' }, items.map((it) => h('li', { class: `td-item k-${it.kind} u${it.urgency}` },
      h('span', { class: 'td-k', title: KIND[it.kind]?.[1] || '' }, it.member ? av(it.member) : KIND[it.kind]?.[0] || '•'),
      h('div', { class: 'td-t' }, h('b', {}, it.title), it.sub ? h('small', { class: 'muted' }, it.sub) : null,
        (it.kind === 'reply' || it.kind === 'approval') && it.detail ? h('div', { class: `td-detail ${it.kind === 'reply' ? 'draft' : ''}` }, it.detail) : null),
      h('div', { class: 'td-a' }, ...actions(it).filter(Boolean))))));
  }

  /* ---------- Team at work ---------- */
  function teamPanel() {
    const rows = (TD.team || []).filter((m) => m.enabled || m.running);
    const head = h('div', { class: 'td-h' }, h('h3', {}, 'Team at work'), h('span', { class: 'muted small' }, `${rows.filter((m) => m.running).length} working · $${TD.costToday || 0} today`),
      h('span', { class: 'spacer' }), h('button', { class: 'linkbtn small', onclick: () => window.openTeam?.() }, 'Open Team'));
    if (!rows.length) return h('div', { class: 'td-card td-team' }, head, h('div', { class: 'td-empty' }, 'No teammates are on. ', h('button', { class: 'linkbtn', onclick: () => window.openTeam?.() }, 'Switch one on')));
    return h('div', { class: 'td-card td-team' }, head, h('div', { class: 'td-rows' }, rows.map((m) => {
      const now = m.running ? (m.step ? `Now: ${m.step}` : 'Working…') : m.stuck?.totally ? `Stuck: needs you to ${m.stuck.needFromYou}` : m.summary || 'Waiting for its first shift';
      return h('button', { class: `td-row ${m.running ? 'run' : ''} ${m.stuck?.totally ? 'stuck' : ''}`, onclick: () => window.openTeam?.(m.id) },
        av(m, 'md'),
        h('span', { class: 'td-rn' }, h('b', {}, m.name, m.level ? h('span', { class: `tm-lv l${m.level}` }, `Lv ${m.level}`) : null), h('small', { class: 'muted' }, m.role)),
        h('span', { class: 'td-rs' },
          h('span', { class: 'td-now' }, m.running ? h('span', { class: 'tm-pulse' }) : null, now),
          h('small', { class: 'muted' }, [m.focus?.length ? m.focus.map((f) => f.key || f.title).filter(Boolean).join(', ') : null, m.working ? `${m.working} in progress` : null, !m.running && m.dayDone ? 'done for the day' : !m.running && m.nextShiftAt ? `next ${until(m.nextShiftAt)}` : null].filter(Boolean).join(' · '))),
        h('span', { class: 'td-rb' },
          m.stuck?.totally ? h('span', { class: 'pill red' }, 'Blocked') : m.running ? h('span', { class: 'pill green' }, 'Working') : null,
          m.waiting ? h('span', { class: 'pill amber', title: 'Items waiting on someone; it keeps working on other things' }, `${m.waiting} waiting`) : null,
          m.needsYou ? h('span', { class: 'pill violet' }, `${m.needsYou} for you`) : null));
    })));
  }

  /* ---------- Done today ---------- */
  function donePanel() {
    const all = TD.done || [];
    const c = TD.doneCounts || {};
    const names = Object.keys(c.byWho || {}).filter((n) => n !== 'You');
    const list = all.filter((d) => filter === 'all' || (filter === 'you' ? d.who.you : d.who.name === filter));
    const shown = showAll ? list : list.slice(0, 6);
    const chip = (id, label) => h('button', { class: `chip ${filter === id ? 'on' : ''}`, onclick: () => { filter = id; showAll = false; paint(); } }, label);
    return h('div', { class: 'td-card td-done' },
      h('div', { class: 'td-h' }, h('h3', {}, 'Done today'), h('span', { class: 'muted small' }, `${c.total || 0} things · you ${c.you || 0} · team ${c.team || 0}`)),
      h('div', { class: 'td-chips' }, chip('all', 'All'), chip('you', `You ${c.byWho?.You || 0}`), names.map((n) => chip(n, `${n} ${c.byWho[n]}`))),
      shown.length ? h('ul', { class: 'td-feed' }, shown.map((d) => h('li', {},
        h('span', { class: 'td-time muted small' }, time(d.at)), av(d.who),
        h('span', { class: 'td-ft' }, h('b', {}, d.who.name), ' ', d.text, d.approvedByYou ? h('span', { class: 'muted small' }, ' · you approved') : null),
        d.url ? h('a', { class: 'link small', href: d.url, title: 'Open what went out' }, '↗') : null)))
        : h('div', { class: 'td-empty' }, filter === 'all' ? 'Nothing finished yet today.' : 'Nothing from them yet today.'),
      list.length > 6 ? h('button', { class: 'linkbtn small', onclick: () => { showAll = !showAll; paint(); } }, showAll ? 'Show less' : `Show all ${list.length}`) : null);
  }

  function paint() {
    let sec = $('s-today');
    if (!sec) { sec = h('section', { id: 's-today' }); $('main').prepend(sec); }
    if (!TD) { sec.replaceChildren(h('div', { class: 'td-grid' }, h('div', { class: 'td-card' }, h('div', { class: 'muted' }, 'Gathering your day…')))); return; }
    HQ.repaint(sec, () => h('div', { class: 'td-grid' }, yourPart(), teamPanel(), donePanel()));
  }

  /* ---------- Steps: tag and fold what a teammate handles ---------- */
  function fold() {
    if (!TD?.owned) return;
    for (const id of ['s-github', 's-jira', 's-slack', 's-work']) {
      const sec = $(id);
      if (!sec) continue;
      const lists = new Map();
      for (const row of sec.querySelectorAll('a.row, .card[data-url]')) {
        if (row.closest('.tm-fold')) continue;
        const o = window.teamOwns(row.getAttribute('href') || row.dataset.url || '') || window.teamOwns(row.textContent.slice(0, 200));
        if (!o) continue;
        if (!row.querySelector('.td-chip')) row.append(h('span', { class: 'td-chip', title: `${o.name} is handling this` }, `${o.emoji || ''} ${o.name}`));
        const parent = row.parentElement;
        if (!lists.has(parent)) lists.set(parent, []);
        lists.get(parent).push(row);
      }
      for (const [parent, rows] of lists) {
        const det = h('details', { class: 'tm-fold' }, h('summary', { class: 'muted small' }, `Handled by the team (${rows.length})`));
        rows.forEach((r) => det.append(r));
        parent.append(det);
      }
    }
  }

  HQ.onRender(() => { paint(); fold(); });
  load();
  clearInterval(pollT);
  pollT = setInterval(load, 20_000);
  window.addEventListener('team:changed', () => setTimeout(load, 300));
})();
