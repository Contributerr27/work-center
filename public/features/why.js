/* "Why is this blocked?" — hover any element with data-why-key (a blocked story, a blocker) to see the
   reasons; click to pin it open. Reasons come from Jira (status, flag, blocking links, late), the project's
   AI brief, and the latest Jira comments and description. Uses page globals: h, $. */
(() => {
  let pop = null, pinned = false, hideT = null, current = null;
  const cache = new Map();
  const fmt = (d) => (d ? new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');

  function el() {
    if (!pop) {
      pop = h('div', { id: 'why-pop', role: 'tooltip', hidden: true,
        onmouseenter: () => clearTimeout(hideT), onmouseleave: () => { if (!pinned) hideSoon(); } });
      document.body.append(pop);
    }
    return pop;
  }
  function place(target) {
    const r = target.getBoundingClientRect(), p = el();
    const w = p.offsetWidth, hh = p.offsetHeight;
    let left = Math.min(r.left, innerWidth - w - 12), top = r.bottom + 8;
    if (top + hh > innerHeight - 12) top = Math.max(12, r.top - hh - 8);
    p.style.left = `${Math.max(12, left)}px`; p.style.top = `${top}px`;
  }
  function render(key, d, loading) {
    const sec = (label, body) => (body ? h('div', { class: 'why-sec' }, h('div', { class: 'why-l' }, label), body) : null);
    const list = (items) => (items?.length ? h('ul', {}, items) : null);
    el().replaceChildren(...[
      h('div', { class: 'why-head' }, h('b', {}, `Why ${key} is blocked`), pinned ? h('button', { class: 'why-x', 'aria-label': 'Close', onclick: hide }, '×') : h('small', { class: 'muted' }, 'click to pin')),
      d?.title ? h('div', { class: 'why-title' }, d.title, d.status ? h('span', { class: 'pill red' }, d.status) : null) : null,
      sec('In Jira', list([
        ...(d?.reasons || []).map((r) => h('li', {}, r)),
        ...(d?.blockedBy || []).map((b) => h('li', {}, 'Waiting on ', h('b', {}, b.key), b.title ? ` ${b.title}` : '', b.status ? h('span', { class: 'muted' }, ` (${b.status})`) : null)),
        d?.overdue ? h('li', {}, `Past its deadline (${fmt(d.overdue)})`) : null,
      ].filter(Boolean))),
      sec('From the AI brief', list((d?.ai || []).map((a) => h('li', {}, a.text, a.owner ? h('span', { class: 'muted' }, ` · ${a.owner}`) : null)))),
      sec('Latest comments', list((d?.comments || []).map((c) => h('li', {}, h('span', { class: 'muted' }, `${c.who} · ${fmt(c.at)}: `), c.text)))),
      !d?.comments?.length && d?.description ? sec('Description', h('p', {}, d.description)) : null,
      loading ? h('div', { class: 'muted small pulse' }, 'Reading Jira…') : null,
      !loading && d && !(d.reasons?.length || d.blockedBy?.length || d.ai?.length || d.comments?.length || d.description) ? h('div', { class: 'muted small' }, 'Jira does not say why. Ask the AI: right-click → Ask AI.') : null,
      d?.url ? h('a', { class: 'link small', href: d.url }, `Open ${key} in Jira ↗`) : null].filter(Boolean));
  }
  async function show(target) {
    clearTimeout(hideT);
    const key = target.dataset.whyKey;
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
    place(target);
    if (!local) {
      try {
        const r = await fetch(`/api/projects/why?key=${encodeURIComponent(key)}`);
        const d = await r.json();
        if (r.ok) cache.set(key, d);
        if (current === target && !el().hidden) { render(key, r.ok ? d : { ...quick, error: d.error }, false); place(target); }
      } catch (e) { if (current === target) render(key, quick, false); }
    }
  }
  function hide() { pinned = false; current = null; if (pop) pop.hidden = true; }
  function hideSoon() { clearTimeout(hideT); hideT = setTimeout(() => { if (!pinned) hide(); }, 220); }

  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-why-key]');
    if (t && t !== current && !pinned) show(t);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target.closest?.('[data-why-key]');
    if (t && !pinned && !t.contains(e.relatedTarget) && !pop?.contains(e.relatedTarget)) hideSoon();
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-why-key]');
    if (t) { e.preventDefault(); e.stopPropagation(); pinned = true; show(t); return; }
    if (pop && !pop.hidden && !pop.contains(e.target)) hide();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop && !pop.hidden) hide(); });
  window.addEventListener('scroll', () => { if (!pinned) hide(); }, true);
})();
