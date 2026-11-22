// Settings: the app ships generic defaults (config.json, nothing personal or company-specific);
// everything about the person using it lives in their own settings file, outside the app:
//   $DAILYHQ_HOME/settings.json   (default ~/.daily-hq/settings.json)
// The live `config` object is the defaults with the settings merged over them. save() updates the
// file and the same object in place, so code holding `config` sees changes right away.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const expand = (p) => String(p || '').replace(/^~(?=\/|\\|$)/, os.homedir());
const HOME = expand(process.env.DAILYHQ_HOME || '~/.daily-hq');
const FILE = path.join(HOME, 'settings.json');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));
// b wins; objects merge key by key; null in b removes the key.
function merge(a, b) {
  const out = isObj(a) ? a : {};
  for (const [k, v] of Object.entries(b || {})) {
    if (v === null) delete out[k];
    else if (isObj(v)) out[k] = merge(isObj(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };

const defaults = readJson(path.join(ROOT, 'config.json'), {});
let saved = readJson(FILE, null);
if (!saved) {
  saved = {};
  // Older builds kept personal values in config.json: carry them over once.
  if (defaults.owner?.name) {
    const { port, ...rest } = defaults;
    saved = rest;
  }
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2));
}

const BASE = { github: {}, jira: {}, owner: {}, ai: {}, prd: {} };
const config = merge(merge(clone(BASE), clone(defaults)), clone(saved));

function save(patch) {
  saved = merge(readJson(FILE, saved) || {}, clone(patch));
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2));
  const next = merge(merge(clone(BASE), clone(defaults)), clone(saved));
  for (const k of Object.keys(config)) delete config[k];
  Object.assign(config, next);
  return config;
}

// Data (tasks, runs, caches) lives outside the app bundle, which is read-only when packaged.
const DATA = expand(process.env.MORNING_DESK_DATA || config.dataDir || path.join(HOME, 'data'));

module.exports = { config, save, saved: () => saved, FILE, HOME, DATA, ROOT, expand, merge };
