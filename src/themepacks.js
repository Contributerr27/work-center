// Theme packs: themes anyone can build and install without touching Work Center's code.
// A pack is a folder with theme.json (see THEMES.md) and optional theme.css, wallpaper, logo, app icon.
// Packs are data only: no scripts. CSS is cleaned (no @import, no remote url()), icons are sanitized in
// the page, files are served only from inside the pack folder and only with image/font/css types.
//
// Where packs live: <app>/theme-packs (examples that ship with the app) and ~/.daily-hq/themes
// (installed by you; wins on the same id).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { HOME, ROOT } = require('./settings');

const USER_DIR = path.join(HOME, 'themes');
const BUILTIN_DIR = path.join(ROOT, 'theme-packs');
const RESERVED = new Set(['normal', 'vice', 'winter']);
const BASES = ['normal', 'vice', 'winter'];
const ID = /^[a-z][a-z0-9-]{1,30}$/;
const FILE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const ALLOWED = new Set([...Object.keys(FILE_TYPES), '.json', '.md', '.txt']);
const MAX_BYTES = 30 * 1024 * 1024;
const EFFECTS = ['none', 'snow', 'sparks', 'stars', 'rain'];
const TERM_KEYS = ['day', 'score', 'board', 'step', 'stepsDone', 'passed', 'wrap', 'wrapTitle', 'messages', 'focus', 'perDay', 'bugs', 'stories', 'debrief', 'weekly'];
const STEP_KEYS = ['github', 'health', 'jira', 'slack', 'work', 'meet'];

const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const color = (v) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(v.trim()) ? v.trim() : null);
// Token values: colors, lengths, shadows, gradients. No url(), no expressions, no braces or semicolons.
const tokenVal = (v) => (typeof v === 'string' && v.length < 400 && !/[;{}<>\\]|url\s*\(|expression|@import/i.test(v) ? v.trim() : null);
const inside = (dir, f) => { const p = path.resolve(dir, f); return p.startsWith(path.resolve(dir) + path.sep) ? p : null; };
const fileIn = (dir, f) => { if (typeof f !== 'string' || !f) return null; const p = inside(dir, f); return p && fs.existsSync(p) && fs.statSync(p).isFile() && FILE_TYPES[path.extname(p).toLowerCase()] ? path.relative(dir, p) : null; };

// Read and validate a pack folder. Returns { pack } or { error }.
function readPack(dir) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf8')); } catch (e) { return { error: `theme.json is missing or not valid JSON (${e.message})` }; }
  const id = str(raw.id, 32).toLowerCase();
  if (!ID.test(id)) return { error: 'theme.json "id" must be 2–31 lowercase letters, digits or dashes, starting with a letter' };
  if (RESERVED.has(id)) return { error: `"${id}" is a built-in theme; pick another id` };
  const name = str(raw.name, 40);
  if (!name) return { error: 'theme.json needs a "name"' };
  const tokens = {};
  for (const [k, v] of Object.entries(raw.tokens || {})) { const val = tokenVal(v); if (/^--[a-z0-9-]{1,40}$/i.test(k) && val) tokens[k] = val; }
  const icons = {};
  for (const [k, v] of Object.entries(raw.icons || {})) if (/^[a-z][a-z0-9-]{0,30}$/.test(k) && typeof v === 'string' && v.length < 4000) icons[k] = v; // sanitized in the page
  const pick = (obj, keys, max) => Object.fromEntries(keys.filter((k) => typeof obj?.[k] === 'string' && obj[k].trim()).map((k) => [k, str(obj[k], max)]));
  const fx = raw.effect || {};
  const pack = {
    id, name,
    description: str(raw.description, 160), author: str(raw.author, 60), version: str(raw.version, 20) || '1.0.0',
    base: BASES.includes(raw.base) ? raw.base : 'normal',
    swatches: (Array.isArray(raw.swatches) ? raw.swatches : []).map(color).filter(Boolean).slice(0, 3),
    tokens,
    orb: (Array.isArray(raw.orb?.colors) ? raw.orb.colors : []).map(color).filter(Boolean).slice(0, 4),
    effect: { kind: EFFECTS.includes(fx.kind) ? fx.kind : 'none', color: color(fx.color) || null, density: Math.max(.2, Math.min(2, Number(fx.density) || 1)) },
    terms: pick(raw.terms, TERM_KEYS, 40),
    steps: pick(raw.steps, STEP_KEYS, 40),
    icons,
    files: { css: fileIn(dir, raw.css || 'theme.css'), wallpaper: fileIn(dir, raw.wallpaper) || ['wallpaper.jpg', 'wallpaper.png', 'wallpaper.webp'].map((f) => fileIn(dir, f)).find(Boolean) || null,
      logo: fileIn(dir, raw.logo || 'logo.png'), icon: fileIn(dir, raw.appIcon || 'icon.png') },
  };
  if (pack.files.css && !pack.files.css.endsWith('.css')) pack.files.css = null;
  return { pack };
}

function scan(dir, source) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => {
    const full = path.join(dir, d.name);
    const r = readPack(full);
    return r.error ? { folder: d.name, source, error: r.error } : { ...r.pack, source, dir: full };
  });
}
// All packs, user packs winning over the bundled examples with the same id.
function list() {
  const byId = new Map(), broken = [];
  for (const p of [...scan(BUILTIN_DIR, 'bundled'), ...scan(USER_DIR, 'installed')]) (p.error ? broken.push(p) : byId.set(p.id, p));
  return { packs: [...byId.values()], broken, folder: USER_DIR };
}
const find = (id) => list().packs.find((p) => p.id === id) || null;

// The pack's stylesheet: its tokens, wallpaper and own CSS, cleaned and scoped to [data-pack="<id>"].
function css(p) {
  const sel = `:root[data-pack="${p.id}"]`;
  const out = [`/* Theme pack: ${p.name.replace(/\*\//g, '')} */`];
  const tokens = { ...p.tokens };
  if (p.orb.length) p.orb.forEach((c, i) => (tokens[`--o${i + 1}`] = c));
  if (Object.keys(tokens).length) out.push(`${sel}, ${sel} #aib-fab { ${Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
  if (p.files.wallpaper) {
    const u = `/theme-pack/${p.id}/${p.files.wallpaper.split(path.sep).map(encodeURIComponent).join('/')}`;
    out.push(`${sel} { --wallpaper: url("${u}"); }`);
    out.push(`${sel} body { background: var(--wallpaper-tint, linear-gradient(transparent, transparent)), var(--wallpaper) center / cover no-repeat fixed; }`);
    out.push(`${sel} { --view-bg: var(--wallpaper-tint, linear-gradient(transparent, transparent)), var(--wallpaper) center / cover no-repeat fixed; }`);
  }
  if (p.files.css) {
    let c = fs.readFileSync(path.join(p.dir, p.files.css), 'utf8').slice(0, 400_000);
    c = c.replace(/@import[^;]*;?/gi, '/* @import removed */');
    c = c.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, q, u) => {
      if (/^data:(image\/(png|jpeg|webp|gif)|font\/)/i.test(u)) return m;
      if (/^([a-z]+:|\/\/|\/)/i.test(u)) return 'url("about:invalid")'; // nothing from the network or the app's other files
      const f = fileIn(p.dir, path.join(path.dirname(p.files.css), u));
      return f ? `url("/theme-pack/${p.id}/${f.split(path.sep).map(encodeURIComponent).join('/')}")` : 'url("about:invalid")';
    });
    out.push(c);
  }
  return out.join('\n');
}

// What the page needs (no folder paths).
const forPage = (p) => ({ id: p.id, name: p.name, description: p.description, author: p.author, version: p.version, base: p.base, swatches: p.swatches,
  effect: p.effect, terms: p.terms, steps: p.steps, icons: p.icons, source: p.source,
  logo: p.files.logo ? `/theme-pack/${p.id}/${p.files.logo}` : null, css: `/theme-pack/${p.id}.css?v=${encodeURIComponent(p.version)}` });

function folderSize(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`links are not allowed (${e.name})`);
    if (e.isDirectory()) n += folderSize(f);
    else { if (!ALLOWED.has(path.extname(e.name).toLowerCase()) && !e.name.startsWith('.')) throw new Error(`file type not allowed: ${e.name}`); n += fs.statSync(f).size; }
  }
  return n;
}

// Install from a folder or a .zip on this computer. Copies into ~/.daily-hq/themes/<id>.
function install(src) {
  src = path.resolve(String(src || ''));
  if (!fs.existsSync(src)) throw new Error('That file or folder does not exist');
  let dir = src, tmp = null;
  if (fs.statSync(src).isFile()) {
    if (!/\.zip$/i.test(src)) throw new Error('Pick a theme folder or a .zip');
    tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wc-theme-'));
    try { execFileSync(process.platform === 'darwin' ? 'ditto' : 'unzip', process.platform === 'darwin' ? ['-x', '-k', src, tmp] : ['-q', src, '-d', tmp], { timeout: 60_000 }); }
    catch (e) { throw new Error(`Could not open the zip: ${e.message}`); }
    // The zip may hold the pack at its root or inside one folder.
    const kids = fs.readdirSync(tmp).filter((n) => !n.startsWith('.') && n !== '__MACOSX');
    dir = fs.existsSync(path.join(tmp, 'theme.json')) ? tmp : kids.length === 1 ? path.join(tmp, kids[0]) : tmp;
  }
  try {
    const r = readPack(dir);
    if (r.error) throw new Error(r.error);
    if (folderSize(dir) > MAX_BYTES) throw new Error('Theme is larger than 30 MB');
    fs.mkdirSync(USER_DIR, { recursive: true });
    const dest = path.join(USER_DIR, r.pack.id);
    if (path.resolve(dest) === path.resolve(dir)) return forPage({ ...r.pack, source: 'installed', dir: dest });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(dir, dest, { recursive: true, filter: (f) => !path.basename(f).startsWith('.') || f === dir });
    return forPage({ ...r.pack, source: 'installed', dir: dest });
  } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
}
function remove(id) {
  if (!ID.test(id || '')) throw new Error('Unknown theme');
  const d = path.join(USER_DIR, id);
  if (!fs.existsSync(d)) throw new Error('Only installed themes can be removed');
  fs.rmSync(d, { recursive: true, force: true });
}

// Serve /theme-pack/<id>.css and /theme-pack/<id>/<file>. Returns true when handled.
function serve(pathname, res) {
  let m = /^\/theme-pack\/([a-z][a-z0-9-]{1,30})\.css$/.exec(pathname);
  if (m) {
    const p = find(m[1]);
    res.writeHead(p ? 200 : 404, { 'content-type': 'text/css', 'cache-control': 'no-cache' });
    res.end(p ? css(p) : '/* no such theme */');
    return true;
  }
  m = /^\/theme-pack\/([a-z][a-z0-9-]{1,30})\/(.+)$/.exec(pathname);
  if (!m) return false;
  const p = find(m[1]);
  const rel = p && fileIn(p.dir, decodeURIComponent(m[2]));
  if (!rel) { res.writeHead(404); res.end(); return true; }
  res.writeHead(200, { 'content-type': FILE_TYPES[path.extname(rel).toLowerCase()], 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(path.join(p.dir, rel)).pipe(res);
  return true;
}
// The app icon for a theme id: a pack's icon.png, or null (built-in themes use build/icons).
const appIcon = (id) => { const p = find(id); return p?.files.icon ? path.join(p.dir, p.files.icon) : null; };

module.exports = { list: () => { const l = list(); return { packs: l.packs.map(forPage), broken: l.broken.map(({ folder, source, error }) => ({ folder, source, error })), folder: l.folder }; },
  install, remove, serve, appIcon, find, USER_DIR };
