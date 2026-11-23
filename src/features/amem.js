'use strict';
// amem side panel: shows amem's live Activity view (what your AI tools remember and recall) beside
// Work Center, on the left or right. Only offered when the amem CLI is installed
// (https://github.com/sslugic/amem). amem serves the view itself on localhost; when it isn't
// running, Work Center starts `amem ui --no-open` in the background.
// Setting `amem.uiPort` (default 7843) matches amem's own `--port`.
const { spawn } = require('node:child_process');
const { which } = require('../detect');
const { env } = require('../collect');

function setup(ctx) {
  const port = () => Number(ctx.config.amem?.uiPort) || 7843;
  const base = () => `http://127.0.0.1:${port()}`;

  async function health() {
    try {
      const r = await fetch(`${base()}/api/health`, { signal: AbortSignal.timeout(1500) });
      const j = await r.json();
      return j?.ok ? j : null;
    } catch { return null; }
  }
  let installed = null; // checked once; `which` is cheap but not free
  const isInstalled = () => (installed ??= !!which('amem'));

  ctx.route('GET', '/api/amem', async () => {
    if (!isInstalled()) return { installed: false };
    const h = await health();
    return { installed: true, running: !!h, activity: !!h?.features?.includes('activity'), version: h?.version || null, url: `${base()}/activity/mini`, dashboard: `${base()}/` };
  });

  let starting = null;
  ctx.route('POST', '/api/amem/start', async () => {
    if (!isInstalled()) return { ok: false, error: 'amem is not installed' };
    if (await health()) return { ok: true };
    starting ||= (async () => {
      const child = spawn('amem', ['ui', '--no-open', '--port', String(port())], { env, detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 500)); if (await health()) return true; }
      return false;
    })().finally(() => { starting = null; });
    return (await starting) ? { ok: true } : { ok: false, error: `amem didn't answer on port ${port()}` };
  });
}

module.exports = { setup };
