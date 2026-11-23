'use strict';
// Stale-while-revalidate cache, kept on disk so views open instantly, even right after a restart.
//
//   const c = cache.create(DATA, 'projects', { ttl: 10 * 60_000, load: () => fetchFromJira() });
//   await c.get()          → the cached value at once (refreshing it in the background when older than ttl);
//                            waits only when nothing was ever cached
//   await c.get(true)      → waits for a fresh value
//   c.expire()             → the next get() refreshes in the background, still serving the old value
//   c.peek()               → { value, at, refreshing, error } without loading anything
//
// A failed refresh keeps the last good value and records the error, so a slow or broken source
// never blanks a view. Values must be JSON-serialisable (convert Maps before caching).
const fs = require('node:fs');
const path = require('node:path');

function create(dataDir, name, { ttl, load, version = 1, persist = !process.env.WORK_CENTER_DEMO }) {
  const dir = path.join(dataDir, 'cache');
  const file = path.join(dir, `${name.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  let entry = null; // { v, at, value }
  let inflight = null;
  let error = null;

  if (persist) {
    try {
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (disk && disk.v === version) entry = disk;
    } catch { /* first run */ }
  }

  function save() {
    if (!persist || !entry) return;
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch { /* data dir gone: memory still works */ }
  }

  function refresh() {
    inflight ||= Promise.resolve()
      .then(load)
      .then((value) => { entry = { v: version, at: Date.now(), value }; error = null; save(); return value; })
      .catch((e) => { error = e.message || String(e); if (!entry) throw e; return entry.value; })
      .finally(() => { inflight = null; });
    return inflight;
  }

  const age = () => (entry ? Date.now() - entry.at : Infinity);
  return {
    async get(force = false) {
      if (force || !entry) return refresh();
      if (age() > (typeof ttl === 'function' ? ttl() : ttl)) refresh().catch(() => {});
      return entry.value;
    },
    refresh,
    expire() { if (entry) entry.at = 0; },
    set(value) { entry = { v: version, at: Date.now(), value }; save(); },
    peek: () => ({ value: entry?.value, at: entry ? new Date(entry.at).toISOString() : null, refreshing: !!inflight, error }),
    get refreshing() { return !!inflight; },
    get at() { return entry?.at || 0; },
  };
}

module.exports = { create };
