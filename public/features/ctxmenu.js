/* Right-click menu everywhere: Cut, Copy, Paste, Select all, and "Ask AI" — which points the AI bubble
   at the selected text, or at the card / row / section you clicked (its text and link go with the message).
   Uses page globals: h, $, toast. */
(() => {
  // The nearest thing worth talking about, from most to least specific.
  const ITEM = '.prj-row, .hr-ans, .hr-imp, .hr-p, .hr-dim, .aic-msg, .aic-item, .tcard, .card, .hm-prj-row, li, .prj-card, .hm-card, .tile, .panel, section';
  let menu = null;

  function itemOf(el) {
    const it = el?.closest?.(ITEM);
    if (!it || it.closest('#side, #ctx-menu, #aib-win')) return null;
    const head = it.querySelector('h1, h2, h3, b, .prj-key, a.link');
    const link = it.querySelector('a[href^="http"]') || (it.matches('a[href^="http"]') ? it : null);
    return {
      text: (it.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2500),
      title: (head?.innerText || '').trim().slice(0, 80),
      url: link?.href || null,
    };
  }
  function where() {
    const v = window.viewContext?.() || {};
    return v.label || v.view || 'Work Center';
  }

  function close() { if (menu) menu.hidden = true; }
  function open(e) {
    const t = e.target;
    const editable = t.closest?.('input, textarea, [contenteditable="true"]');
    const sel = String(window.getSelection?.() || '').trim();
    const item = itemOf(t);
    if (!menu) { menu = h('div', { id: 'ctx-menu', role: 'menu', 'aria-label': 'Actions' }); document.body.append(menu); }
    const act = (label, key, fn, enabled = true) => h('button', { class: 'cm-item', role: 'menuitem', disabled: !enabled, onclick: () => { close(); fn(); } }, h('span', {}, label), key ? h('kbd', {}, key) : null);
    const exec = (cmd) => () => { editable?.focus(); if (!document.execCommand(cmd)) toast(`${cmd} is not available here`); };
    const paste = async () => {
      editable?.focus();
      if (document.execCommand('paste')) return;
      try {
        const txt = await navigator.clipboard.readText();
        if (editable && 'setRangeText' in editable) { editable.setRangeText(txt, editable.selectionStart, editable.selectionEnd, 'end'); editable.dispatchEvent(new Event('input', { bubbles: true })); } else document.execCommand('insertText', false, txt);
      } catch (err) { toast('Press ⌘V to paste'); }
    };
    const ask = (quote) => window.askAIBubble ? window.askAIBubble(quote) : toast('The AI bubble is still loading');
    const askLabel = sel ? `Ask AI about “${sel.length > 28 ? `${sel.slice(0, 28)}…` : sel}”` : item?.title ? `Ask AI about “${item.title.length > 28 ? `${item.title.slice(0, 28)}…` : item.title}”` : 'Ask AI about this view';
    menu.replaceChildren(
      act('✦ ' + askLabel, null, () => ask(sel
        ? { text: sel.slice(0, 2500), where: `selected text in ${where()}`, url: item?.url || null }
        : item ? { text: item.text, where: `the "${item.title || 'item'}" card in ${where()}`, url: item.url }
          : { text: `(the ${where()} view as a whole)`, where: where(), url: null })),
      h('div', { class: 'cm-sep', role: 'separator' }),
      act('Cut', '⌘X', exec('cut'), !!editable && !!sel),
      act('Copy', '⌘C', editable && sel ? exec('copy') : () => navigator.clipboard?.writeText(sel || item?.text || '').then(() => toast(sel ? 'Copied' : 'Copied the card'), () => document.execCommand('copy')), !!sel || !!item),
      act('Paste', '⌘V', paste, !!editable),
      act('Select all', '⌘A', () => { if (editable) { editable.focus(); editable.select?.(); } else document.execCommand('selectAll'); }));
    menu.hidden = false;
    const w = menu.offsetWidth, hh = menu.offsetHeight;
    menu.style.left = `${Math.min(e.clientX, innerWidth - w - 8)}px`;
    menu.style.top = `${Math.min(e.clientY, innerHeight - hh - 8)}px`;
    menu.querySelector('.cm-item')?.focus({ preventScroll: true });
  }

  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest?.('.xterm')) return; // the terminal keeps its own menu
    e.preventDefault();
    open(e);
  });
  document.addEventListener('click', (e) => { if (menu && !menu.hidden && !menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => {
    if (!menu || menu.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...menu.querySelectorAll('.cm-item:not(:disabled)')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  window.addEventListener('blur', close);
  window.addEventListener('scroll', close, true);
})();
