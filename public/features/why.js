/* "Why is this blocked?" — hover any element with data-why-key (a blocked story, a blocker) to see the
   reasons. Click the item, or anywhere in the popover, to keep it open (× or Esc closes it). Reasons come
   from Jira (status, flag, links, late, assignee), the project's AI brief, the latest comments and the
   description; ✦ Explain asks the AI for a plain-words story from Jira, Slack and meetings.
   Uses page globals: h, $, post, toast. */
(() => {
  let pop = null, pinned = false, hideT = null, showT = null, current = null, inside = false, pollT = null;
  const cache = new Map();
  const fmt = (d) => (d ? new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');
  const ago = (d) => { if (!d) return ''; const n = Math.round((Date.now() - new Date(d)) / 86_400_000); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };

  function el() {
    if (!pop) {
      pop = h('div', { id: 'why-pop', role: 'dialog', 'aria-label': 'Why it is blocked', hidden: true,
        onmouseenter: () => { inside = true; clearTimeout(hideT); },
        onmouseleave: () => { inside = false; if (!pinned) hideSoon(); } });
      // Any click inside keeps it open.
      pop.addEventListener('click', () => { if (!pinned) { pinned = true; repaint(); } });
      document.body.append(pop);
    }
    return pop;
  }
  // Placed once per item; later content loads only grow it within the screen, never move it under the pointer.
  function place(target) {
    const r = target.getBoundingClientRect(), p = el();
    const w = p.offsetWidth, hh = p.offsetHeight;
    const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
    let top = r.bottom + 4;
    if (top + hh > innerHeight - 12) top = Math.max(12, r.top - hh - 4);
    p.style.left = `${left}px`; p.style.top = `${top}px`;
  }
  function keepOnScreen() {
    const p = el(), rect = p.getBoundingClientRect();
    if (rect.bottom > innerHeight - 12 && !inside) p.style.top = `${Math.max(12, innerHeight - 12 - rect.height)}px`;
  }

  let last = null; // [key, data, loading]
  const repaint = () => last && render(...last);
  function render(key, d, loading) {
    last = [key, d, loading];
    const sec = (label, body, cls = '') => (body ? h('div', { class: `why-sec ${cls}` }, h('div', { class: 'why-l' }, label), body) : null);
    const list = (items) => (items?.length ? h('ul', {}, items) : null);
    const link = (k, url) => h('a', { class: 'link', href: url || `#${k}` }, k);
    const ex = d?.explain, job = d?.explainJob;
    const links = (d?.links || []).slice().sort((a, b) => (b.blocking - a.blocking) || (a.done - b.done));
    const who = [d?.assignee && `Assigned to ${d.assignee}`, d?.reporter && d.reporter !== d.assignee && `reported by ${d.reporter}`, d?.updated && `updated ${ago(d.updated)}`, d?.due && `due ${fmt(d.due)}`].filter(Boolean).join(' · ');

    const explain = ex
      ? sec('In plain words', h('div', { class: 'why-ex' },
        h('p', {}, ex.summary || ''),
        ex.waitingOn ? h('div', { class: 'why-kv' }, h('span', { class: 'muted' }, 'Waiting on '), h('b', {}, ex.waitingOn), ex.owner ? h('span', { class: 'muted' }, ` · ${ex.owner} can unblock it`) : null) : null,
        ex.since ? h('div', { class: 'why-kv muted' }, `Stuck since ${fmt(ex.since)}`) : null,
        ex.unblock?.length ? h('div', {}, h('div', { class: 'why-kv muted' }, 'What would unblock it'), h('ol', {}, ex.unblock.map((u) => h('li', {}, u)))) : null,
        ex.workaround ? h('div', { class: 'why-kv' }, h('span', { class: 'muted' }, 'Meanwhile: '), ex.workaround) : null,
        ex.sources?.length ? h('div', { class: 'why-src' }, ex.sources.slice(0, 4).map((s) => (s.url ? h('a', { class: 'link', href: s.url }, s.title || 'source') : h('span', {}, s.title)))) : null,
        h('div', { class: 'why-kv muted small' }, `Written ${ago(ex.generatedAt)} · `, h('button', { class: 'why-btn link', onclick: (e) => { e.stopPropagation(); explainNow(key); } }, job?.running ? 'Rewriting…' : 'Rewrite'))), 'why-hl')
      : h('div', { class: 'why-sec why-hl' },
        job?.running ? h('div', { class: 'muted small pulse' }, '✦ Reading Jira, Slack and meetings to explain it… (about a minute)')
          : h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); explainNow(key); } }, '✦ Explain in plain words'),
        job?.error ? h('div', { class: 'muted small' }, `Last try failed: ${job.error}`) : null,
        !job?.running ? h('div', { class: 'muted small' }, 'The AI reads the ticket, linked issues, Slack and meeting notes. Read-only.') : null);

    el().replaceChildren(...[
      h('div', { class: 'why-head' }, h('b', {}, `Why ${key} is blocked`),
        pinned ? h('button', { class: 'why-x', 'aria-label': 'Close', title: 'Close (Esc)', onclick: (e) => { e.stopPropagation(); hide(); } }, '×')
          : h('small', { class: 'muted' }, 'click to keep open')),
      d?.title ? h('div', { class: 'why-title' }, d.title, d.status ? h('span', { class: 'pill red' }, d.status) : null) : null,
      who ? h('div', { class: 'why-who muted small' }, who) : null,
      !loading || ex ? explain : null,
      sec('Signals in Jira', list([
        ...(d?.reasons || []).map((r) => h('li', {}, r)),
        d?.overdue ? h('li', {}, `Past its deadline (${fmt(d.overdue)})`) : null,
      ].filter(Boolean))),
      sec('Linked work', list(links.map((l) => h('li', { class: l.done ? 'muted' : '' },
        h('span', { class: 'muted' }, `${l.rel} `), link(l.key, l.url), l.title ? ` ${l.title}` : '', l.status ? h('span', { class: `why-st ${l.done ? 'done' : ''}` }, ` ${l.status}`) : null)))),
      !links.length && d?.blockedBy?.length ? sec('Waiting on', list(d.blockedBy.map((b) => h('li', {}, h('b', {}, b.key), b.title ? ` ${b.title}` : '', b.status ? h('span', { class: 'muted' }, ` (${b.status})`) : null)))) : null,
      sec('From the project brief', list((d?.ai || []).map((a) => h('li', {}, a.text, a.owner ? h('span', { class: 'muted' }, ` · ${a.owner}`) : null)))),
      sec('Latest comments', list((d?.comments || []).map((c) => h('li', {}, h('span', { class: 'muted' }, `${c.who} · ${fmt(c.at)}: `), c.text)))),
      d?.description ? sec('Description', h('details', { open: !d?.comments?.length }, h('summary', { class: 'muted small' }, d.comments?.length ? 'Show description' : 'Description'), h('p', { class: 'why-desc' }, d.description))) : null,
      loading ? h('div', { class: 'muted small pulse' }, 'Reading Jira…') : null,
      !loading && d && !(d.reasons?.length || d.links?.length || d.ai?.length || d.comments?.length || d.description || ex) ? h('div', { class: 'muted small' }, 'Jira does not say why. Try ✦ Explain, or right-click → Ask AI.') : null,
      d?.url ? h('a', { class: 'link small', href: d.url }, `Open ${key} in Jira ↗`) : null].filter(Boolean));
  }

  async function explainNow(key) {
    pinned = true;
    const r = await post('/api/projects/why/explain', { key }).catch((e) => ({ error: e.message }));
    if (r.error) { toast(r.error); return; }
    const d = cache.get(key) || last?.[1] || {};
    d.explainJob = r.job;
    cache.set(key, d);
    if (current && last?.[0] === key) render(key, d, false);
    poll(key);
  }
  function poll(key) {
    clearTimeout(pollT);
    pollT = setTimeout(async () => {
      const r = await fetch(`/api/projects/why/explain?key=${encodeURIComponent(key)}`).then((x) => x.json()).catch(() => null);
      if (!r) return;
      const d = { ...(cache.get(key) || {}), explain: r.explain, explainJob: r.job };
      cache.set(key, d);
      if (!el().hidden && last?.[0] === key) { render(key, d, false); keepOnScreen(); }
      if (r.job?.running) poll(key);
    }, 3000);
  }

  async function show(target) {
    clearTimeout(hideT);
    const key = target.dataset.whyKey;
    const fresh = current !== target;
    current = target;
    const local = cache.get(key);
    // What the page already knows, right away; the Jira read fills in the rest.
    let quick = local;
    if (!quick) {
      const P = window.PROJECT_ITEMS?.(key);
      quick = P ? { title: P.title, status: P.status, reasons: P.why, blockedBy: P.blockedBy, overdue: P.overdue ? P.due : null } : { reasons: target.dataset.whyText ? [target.dataset.whyText] : [] };
    }
    el().hidden = false;
    render(key, quick, !local);
    if (fresh) place(target);
    if (local?.explainJob?.running) poll(key);
    if (!local) {
      try {
        const r = await fetch(`/api/projects/why?key=${encodeURIComponent(key)}`);
        const d = await r.json();
        if (r.ok) cache.set(key, d);
        if (current === target && !el().hidden) { render(key, r.ok ? d : { ...quick, error: d.error }, false); keepOnScreen(); }
        if (r.ok && d.explainJob?.running) poll(key);
      } catch (e) { if (current === target) render(key, quick, false); }
    }
  }
  function hide() { pinned = false; current = null; inside = false; clearTimeout(pollT); if (pop) pop.hidden = true; }
  // Generous grace so the pointer can travel from the item to the popover.
  function hideSoon() { clearTimeout(hideT); hideT = setTimeout(() => { if (!pinned && !inside) hide(); }, 600); }

  document.addEventListener('mouseover', (e) => {
    if (pinned || inside) return;
    const t = e.target.closest?.('[data-why-key]');
    if (!t || t === current) { if (t) clearTimeout(hideT); return; }
    // Short hover intent: passing over another item on the way to the popover doesn't switch to it.
    clearTimeout(showT);
    showT = setTimeout(() => { if (!pinned && !inside && t.matches(':hover')) show(t); }, pop && !pop.hidden ? 250 : 80);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target.closest?.('[data-why-key]');
    if (t && !pinned && !t.contains(e.relatedTarget) && !pop?.contains(e.relatedTarget)) { clearTimeout(showT); hideSoon(); }
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-why-key]');
    if (t) { e.preventDefault(); e.stopPropagation(); pinned = true; if (t === current) repaint(); else show(t); return; }
    if (pop && !pop.hidden && !pop.contains(e.target)) hide();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop && !pop.hidden) hide(); });
  window.addEventListener('scroll', (e) => { if (!pinned && !pop?.contains(e.target)) hide(); }, true);
})();
