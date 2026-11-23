/* Line icons (24px grid, stroke = currentColor) with per-theme variants. Elements with class "a" are an
   accent fill (snow on a roof, a glow), coloured by --ic-acc. icon(name) returns an <svg>; any element
   with data-i="name" is filled in, and every icon is redrawn when the theme changes. */
(() => {
  const B = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11h4.5v-6h4v6h4.5V9"/>',
    day: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    projects: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M8 8v7M12 8v4M16 8v9"/>',
    growth: '<path d="M3.5 3.5v17h17"/><path d="m7.5 15 4-4 3 3 5.5-6"/><path d="M15.5 8h4.5v4.5"/>',
    ai: '<path d="M11 3.5 12.9 9l5.6 1.9-5.6 1.9L11 18.5l-1.9-5.7L3.5 10.9 9.1 9z"/><path d="M18.5 15.5l.7 1.9 1.8.7-1.8.7-.7 1.9-.7-1.9-1.8-.7 1.8-.7z"/>',
    focus: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".9" class="a"/>',
    autopilot: '<rect x="4" y="8" width="16" height="12" rx="3.5"/><path d="M12 4.5V8M9 13v1.5M15 13v1.5M9.5 17.5h5"/><circle cx="12" cy="3.5" r="1"/>',
    wrap: '<path d="M12 3v6M9 6l3 3 3-3"/><path d="M5.5 17a6.5 6.5 0 0 1 13 0"/><path d="M2.5 20.5h19M4.3 11.8l1.3 1.3M19.7 11.8l-1.3 1.3"/>',
    score: '<path d="M8 21h8M12 16.5V21"/><path d="M7 3.5h10V9a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.5A2.5 2.5 0 0 0 7 10M17 5.5h2.5A2.5 2.5 0 0 1 17 10"/>',
    messages: '<path d="M20.5 11.5a8 8 0 0 1-11.6 7.2L4 20.5l1.7-4.6A8 8 0 1 1 20.5 11.5z"/>',
    theme: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6h1.9A4.9 4.9 0 0 0 21 10.5C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11.5" r="1.1"/><circle cx="10" cy="7.3" r="1.1"/><circle cx="15" cy="7.3" r="1.1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    collapse: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M9 3.5v17M16 10l-2 2 2 2"/>',
    expand: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M9 3.5v17M14 10l2 2-2 2"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6l2.5 2.5"/><path d="M20.5 3.5v5h-5"/>',
    scan: '<circle cx="10.5" cy="10.5" r="7"/><path d="m20.5 20.5-5-5"/><path d="M10.5 7.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/>',
    memory: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.5"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2"/>',
    music: '<path d="M9 17.5V5.5l11-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/>',
    list: '<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    // A snowflake (Winter workload marks).
    flake: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.8 3.8 12 6l2.2-2.2M9.8 20.2 12 18l2.2 2.2M3.4 10.2l3 .8-.8 3M20.6 13.8l-3-.8.8-3M3.4 13.8l3-.8-.8-3M20.6 10.2l-3 .8.8 3"/>',
    // Step done: a check in a circle (Winter: a summit flag; Vice: a star).
    done: '<circle cx="12" cy="12" r="9"/><path d="m7.8 12.3 2.8 2.8 5.6-6"/>',
    // The AI orb's center mark.
    orb: '<path d="M12 3.5 13.9 10.1 20.5 12 13.9 13.9 12 20.5 10.1 13.9 3.5 12 10.1 10.1z"/>',
  };
  const V = {
    winter: {
      done: '<path d="m2.5 20.5 7-11.5 3.5 5.5 2.5-3.5 6 9.5z"/><path d="M9.5 9V3.2l4.5 2.1-4.5 2.2"/>',
      orb: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.8 3.8 12 6l2.2-2.2M9.8 20.2 12 18l2.2 2.2M3.4 10.2l3 .8-.8 3M20.6 13.8l-3-.8.8-3M3.4 13.8l3-.8-.8-3M20.6 10.2l-3 .8.8 3"/>',
      home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/><path d="M15.5 6.8V3.5h2.5v5.3"/><path class="a" d="M2.2 11.2 12 3.2l9.8 8-1.7.9L12 5.6 3.9 12.1z"/>',
      day: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.8 3.8 12 6l2.2-2.2M9.8 20.2 12 18l2.2 2.2M3.4 10.2l3 .8-.8 3M20.6 13.8l-3-.8.8-3M3.4 13.8l3-.8-.8-3M20.6 10.2l-3 .8.8 3"/>',
      projects: '<rect x="3.5" y="9" width="17" height="11.5" rx="1.8"/><path d="M3.5 13h17M12 9v11.5"/><path d="M12 9c-1.4-2.9-5-3.8-5-1.4C7 9 10.2 9 12 9zM12 9c1.4-2.9 5-3.8 5-1.4C17 9 13.8 9 12 9z"/>',
      growth: '<path d="m2.5 20 6.5-11 4 6.2 3-4.2 5.5 9z"/><path d="M9 9V3.5l4 2-4 2"/><path class="a" d="m7.2 12 1.8-3 1.8 2.8-1.8 1z"/>',
      ai: '<path d="M12 2.8l2.3 4.9 5.4.7-4 3.7 1 5.3-4.7-2.6-4.8 2.6 1.1-5.3-4-3.7 5.4-.7z"/><path class="a" d="M12 5.8l1.3 2.7 3 .4-2.2 2 .6 3-2.7-1.5-2.6 1.5.5-3-2.2-2 3-.4z"/><path d="M12 19.5v2"/>',
      focus: '<path d="M12 2.5c1.4 1.7 1.8 3 0 4.6-1.8-1.6-1.4-2.9 0-4.6z" class="a"/><path d="M12 2.5c1.4 1.7 1.8 3 0 4.6-1.8-1.6-1.4-2.9 0-4.6z"/><rect x="8.8" y="9" width="6.4" height="12" rx="1.2"/><path d="M8.8 12.5h6.4"/>',
      wrap: '<path d="M4 9.5h12v6.5a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 4 16z"/><path d="M16 11.5h1.3a2.6 2.6 0 0 1 0 5.2H16"/><path d="M8 3c-.9 1.1.9 2.2 0 3.4M12 3c-.9 1.1.9 2.2 0 3.4"/>',
      score: '<circle cx="12" cy="14" r="7"/><path d="M10 7.3V4.5h4v2.8M12 4.5V2.5"/><path d="M5.3 12.6c3.2 1.6 10.2 1.6 13.4 0M5.6 16.2c3.1 1.2 9.7 1.2 12.8 0"/><path class="a" d="M9 10.2a1.3 1.3 0 1 0 0-.01z"/>',
    },
    vice: {
      done: '<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/>',
      orb: '<path d="M13.5 2.5 4.5 14h7l-1 7.5 9-11.5h-7z"/>',
      home: '<path d="M12 21c0-5 .6-9 2.2-12"/><path d="M14.2 9c-1-2.6-4.1-3.6-7.2-2.6 2.6 0 4.6 1 5.7 3.1M14.2 9c1.6-2.3 4.7-2.9 7.3-1.6-2.5-.2-4.6.6-5.7 2.3M14.2 9c.3-2.6-1.2-5-3.7-6.2 1.6 1.9 2.2 3.9 2 6.2M14.2 9c2.1-.8 4.7.2 5.7 2.6"/><path d="M6.5 21h11"/>',
      day: '<path d="M5 15.5a7 7 0 0 1 14 0"/><path d="M3 15.5h18M5.5 18.5h13M8.5 21.5h7"/><path d="M12 3.5v2.5M5.6 6.8 7.3 8.5M18.4 6.8 16.7 8.5"/>',
      ai: '<path d="M13.5 2.5 4.5 14h7l-1 7.5 9-11.5h-7z"/>',
      messages: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M10.8 18.5h2.4M9.5 5.5h5"/>',
      wrap: '<path d="M4.5 16a7.5 7.5 0 0 1 15 0"/><path d="M2.5 16h19M4.5 19h15M7.5 22h9"/><path d="M12 3v5M9.5 5.5 12 8l2.5-2.5"/>',
    },
  };
  const theme = () => document.documentElement.dataset.theme || 'normal';
  const pack = () => document.documentElement.dataset.pack;
  const markup = (name) => ((pack() && V[pack()]?.[name]) || V[theme()]?.[name] || B[name] || '');
  // Icons from theme packs: only drawing shapes and their geometry/style attributes survive.
  const OK_TAGS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g']);
  const OK_ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'transform', 'class', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule']);
  function clean(src) {
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${src}</svg>`, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return '';
    const walk = (n) => {
      for (const c of [...n.children]) {
        if (!OK_TAGS.has(c.localName)) { c.remove(); continue; }
        for (const a of [...c.attributes]) if (!OK_ATTRS.has(a.name) || /url\s*\(|javascript:/i.test(a.value)) c.removeAttribute(a.name);
        walk(c);
      }
    };
    walk(doc.documentElement);
    return doc.documentElement.innerHTML;
  }
  function icon(name, cls = '') {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', `ic ${cls}`); s.setAttribute('aria-hidden', 'true'); s.dataset.icon = name;
    s.innerHTML = markup(name);
    return s;
  }
  function paintAll(root = document) {
    for (const el of root.querySelectorAll('[data-i]')) {
      const name = el.dataset.i;
      const svg = el.querySelector(':scope > svg.ic');
      if (svg) svg.innerHTML = markup(name); else { el.textContent = ''; el.append(icon(name)); }
    }
    for (const svg of root.querySelectorAll('svg.ic[data-icon]')) if (!svg.parentElement?.dataset?.i) svg.innerHTML = markup(svg.dataset.icon);
  }
  window.icon = icon;
  // Theme packs register their own variants: ICONS.register('aurora', { orb: '<path …/>' }).
  const register = (themeId, map) => {
    if (['normal', 'vice', 'winter'].includes(themeId)) return; // built-in sets stay as they are
    const safe = {};
    for (const [k, v] of Object.entries(map || {})) { const c = clean(String(v)); if (c) safe[k] = c; }
    V[themeId] = safe;
    paintAll();
  };
  window.ICONS = { has: (n) => !!B[n], paintAll, register };
  window.addEventListener('themechange', () => paintAll());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => paintAll()); else paintAll();
})();
