/* Markdown for AI replies: headings, lists (nested by indent), bold, italic, code, code blocks, quotes,
   links, rules and simple tables. Builds DOM nodes directly (never innerHTML), so AI text can't inject
   markup. window.md(text) returns a <div class="md">. */
(() => {
  const el = (tag, cls, kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of [].concat(kids || [])) if (k != null) e.append(k); return e; };
  const safeUrl = (u) => (/^(https?:|mailto:)/i.test(u) ? u : null);

  // Inline: `code`, **bold**, __bold__, *italic*, _italic_, ~~strike~~, [text](url), bare URLs.
  const INLINE = /(`[^`]+`)|(\*\*[^*]+?\*\*|__[^_]+?__)|(~~[^~]+?~~)|(\*[^*\s][^*]*?\*|\b_[^_\s][^_]*?_\b)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;
  function inline(text) {
    const out = [];
    let rest = text;
    while (rest) {
      const m = INLINE.exec(rest);
      if (!m) { out.push(rest); break; }
      if (m.index) out.push(rest.slice(0, m.index));
      const t = m[0];
      if (m[1]) out.push(el('code', null, t.slice(1, -1)));
      else if (m[2]) out.push(el('strong', null, inline(t.slice(2, -2))));
      else if (m[3]) out.push(el('s', null, inline(t.slice(2, -2))));
      else if (m[4]) out.push(el('em', null, inline(t.slice(1, -1))));
      else if (m[5]) {
        const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
        const href = safeUrl(url);
        if (href) { const a = el('a', null, inline(label)); a.href = href; a.target = '_blank'; a.rel = 'noopener'; out.push(a); } else out.push(label);
      } else { const a = el('a', null, t); a.href = t; a.target = '_blank'; a.rel = 'noopener'; out.push(a); }
      rest = rest.slice(m.index + t.length);
    }
    return out;
  }

  const LI = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
  function list(lines, i) {
    // Builds one list (and nested ones by indent) starting at lines[i]; returns [node, nextIndex].
    const first = LI.exec(lines[i]);
    const indent = first[1].length, ordered = /\d/.test(first[2]);
    const root = el(ordered ? 'ol' : 'ul');
    if (ordered && parseInt(first[2], 10) !== 1) root.start = parseInt(first[2], 10);
    let li = null;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { // a blank line ends the list unless the next line continues it
        const nx = lines[i + 1] && LI.exec(lines[i + 1]);
        if (nx && nx[1].length >= indent) { i++; continue; }
        break;
      }
      const m = LI.exec(line);
      if (m && m[1].length > indent && li) { const [sub, ni] = list(lines, i); li.append(sub); i = ni; continue; }
      if (m && m[1].length < indent) break;
      if (m) { li = el('li', null, inline(m[3])); root.append(li); i++; continue; }
      if (li && /^\s+\S/.test(line)) { li.append(' ', ...inline(line.trim())); i++; continue; } // wrapped item text
      break;
    }
    return [root, i];
  }

  function table(lines, i) {
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(lines[i]);
    const t = el('table', null, el('thead', null, el('tr', null, head.map((c) => el('th', null, inline(c))))));
    const body = el('tbody');
    i += 2;
    while (i < lines.length && /^\s*\|/.test(lines[i])) { body.append(el('tr', null, cells(lines[i]).map((c) => el('td', null, inline(c))))); i++; }
    t.append(body);
    return [el('div', 'md-table', t), i];
  }

  /* ---------- Charts ----------
     1. A ```chart block with JSON: { "type": "stack" | "bars" | "donut", "title": "...",
        "items": [{ "label": "Added", "value": 2, "tone": "good" }] }. tone: good, info, warn, bad, ai, muted.
     2. Automatic: a sentence that lists counts ("43 checked: 26 already had tests, 15 can't be tested,
        and 2 added") gets a summary bar on top of the reply. */
  const TONES = ['good', 'info', 'warn', 'bad', 'ai', 'muted'];
  function toneOf(label) {
    const l = label.toLowerCase();
    if (/\b(can'?t|cannot|not[- ]testable|not possible|failed|failing|error|broken|blocked|rejected|missing)\b/.test(l)) return 'bad';
    if (/\b(skip|skipped|xfail|pending|waiting|partial|gap|unknown|manual|later)\b/.test(l)) return 'warn';
    if (/\b(added|new|created|fixed|passed|passing|done|merged|resolved|approved|shipped)\b/.test(l)) return 'good';
    if (/\b(already|existing|exist|covered|had|kept|unchanged|known)\b/.test(l)) return 'info';
    return 'ai';
  }
  const fmtN = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  function chart(spec) {
    const items = (Array.isArray(spec?.items) ? spec.items : []).map((x) => ({ label: String(x.label ?? '').slice(0, 60), value: Math.max(0, Number(x.value) || 0), tone: TONES.includes(x.tone) ? x.tone : toneOf(String(x.label ?? '')) }))
      .filter((x) => x.label).slice(0, 12);
    if (!items.length) return null;
    const total = items.reduce((a, x) => a + x.value, 0) || 1;
    const type = ['stack', 'bars', 'donut'].includes(spec.type) ? spec.type : items.length > 5 ? 'bars' : 'stack';
    const box = el('figure', `md-chart md-${type}`);
    if (spec.title) box.append(el('figcaption', null, String(spec.title).slice(0, 80)));
    const legend = () => el('ul', 'md-legend', items.map((x) => el('li', `t-${x.tone}`, [el('i'), el('b', null, fmtN(x.value)), ` ${x.label}`])));
    if (type === 'bars') {
      const max = Math.max(...items.map((x) => x.value)) || 1;
      box.append(el('div', 'md-bars', items.map((x) => {
        const bar = el('span', `md-bar t-${x.tone}`); bar.style.width = `${(x.value / max) * 100}%`;
        return el('div', 'md-row', [el('span', 'md-lab', x.label), el('span', 'md-track', bar), el('b', null, fmtN(x.value))]);
      })));
    } else if (type === 'donut') {
      let acc = 0;
      const stops = items.map((x) => { const a = acc, b = (acc += (x.value / total) * 360); return `var(--c-${x.tone}) ${a}deg ${b}deg`; });
      const ring = el('div', 'md-donut-ring', el('span', null, [el('b', null, fmtN(items.reduce((a, x) => a + x.value, 0))), el('small', null, spec.unit || 'total')]));
      ring.style.background = `conic-gradient(${stops.join(', ')})`;
      box.append(el('div', 'md-donut-wrap', [ring, legend()]));
    } else {
      const bar = el('div', 'md-stackbar', items.filter((x) => x.value > 0).map((x) => { const s = el('span', `t-${x.tone}`); s.style.flexGrow = x.value; s.title = `${x.label}: ${fmtN(x.value)}`; return s; }));
      box.append(bar, legend());
    }
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', `${spec.title ? `${spec.title}: ` : ''}${items.map((x) => `${fmtN(x.value)} ${x.label}`).join(', ')}`);
    return box;
  }
  // Find "N label" parts in one sentence: at least 2 after a colon, or 3 anywhere. A number before the
  // colon that equals their sum becomes the title.
  function autoChart(text) {
    const plain = text.replace(/\*\*|__|`/g, '');
    for (const sentence of plain.split(/(?<=[.!?])\s+|\n/).slice(0, 6)) {
      const [head, tail] = sentence.includes(':') ? [sentence.slice(0, sentence.indexOf(':')), sentence.slice(sentence.indexOf(':') + 1)] : ['', sentence];
      const parts = tail.split(/,\s*(?:and\s+)?|;\s*|\s+and\s+(?=[^,]*\d)/).map((p) => p.trim()).filter(Boolean);
      const items = [];
      for (const p of parts) {
        const m = /^(.*?)\b(\d+(?:\.\d+)?)\b(.*)$/.exec(p);
        if (!m || /#\d|[A-Z]+-\d/.test(p.slice(Math.max(0, m.index), m[1].length + m[2].length + 2))) continue; // skip "PR #12", "ABC-123"
        let label = `${m[1]} ${m[3]}`.replace(/[.,;:!?]+\s*$/, '').replace(/\s+/g, ' ').trim()
          .replace(/\s+(for|to|of|with|in|on|at|by|I|we|have|has)$/i, '').replace(/^(and|I|we)\s+/i, '').trim();
        if (!label || label.length > 50) continue;
        items.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value: Number(m[2]) });
      }
      if (items.length < (head ? 2 : 3)) continue;
      const sum = items.reduce((a, x) => a + x.value, 0);
      const hm = /(\d+)\s+([^\d]*)$/.exec(head);
      const title = hm && Number(hm[1]) === sum ? `${hm[1]} ${hm[2].trim()}` : null;
      if (head && !title && items.length < 3) continue;
      return chart({ type: 'stack', title, items });
    }
    return null;
  }

  // Statuses written as "**KEY (status):**" become colored chips.
  function chipify(root) {
    for (const s of root.querySelectorAll('li > strong:first-child, p > strong:first-child')) {
      const m = /^(.*?)\s*\(([^()]{2,40})\)\s*:?\s*$/.exec(s.textContent);
      if (!m) continue;
      s.textContent = m[1].replace(/:$/, '');
      const tone = /^\d+$/.test(m[2].trim()) ? toneOf(m[1]) : toneOf(m[2].replace(/[-+_]/g, ' '));
      const chip = el('span', `md-chip t-${tone}`, m[2]);
      s.after(' ', chip, ' ');
    }
  }

  window.mdChart = chart;
  window.md = function mdWithCharts(text) {
    const root = md(text);
    if (!root.querySelector('.md-chart')) { const c = autoChart(String(text ?? '')); if (c) root.prepend(c); }
    chipify(root);
    return root;
  };
  function md(text) {
    const root = el('div', 'md');
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    let i = 0, para = [];
    const flush = () => { if (para.length) { const p = el('p'); para.forEach((l, k) => { if (k) p.append(el('br')); p.append(...inline(l)); }); root.append(p); para = []; } };
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (/^\s*```/.test(line)) {
        flush();
        const lang = line.trim().slice(3).trim(), code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        i++;
        if (lang === 'chart') {
          let c = null;
          try { c = chart(JSON.parse(code.join('\n'))); } catch (e) { /* not valid JSON: show it as code */ }
          if (c) { root.append(c); continue; }
        }
        const pre = el('pre', null, el('code', null, code.join('\n')));
        if (lang) pre.dataset.lang = lang;
        root.append(pre);
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        flush(); root.append(el(`h${Math.min(6, m[1].length + 2)}`, null, inline(m[2].replace(/\s*#+\s*$/, '')))); i++;
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); root.append(el('hr')); i++; }
      else if (LI.test(line)) { flush(); const [node, ni] = list(lines, i); root.append(node); i = ni; }
      else if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) { flush(); const [node, ni] = table(lines, i); root.append(node); i = ni; }
      else if (/^\s*>/.test(line)) {
        flush();
        const q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        root.append(el('blockquote', null, [...md(q.join('\n')).childNodes]));
      } else if (!line.trim()) { flush(); i++; }
      else { para.push(line); i++; }
    }
    flush();
    return root;
  };
})();
