// Smoke test: the demo starts on made-up data and /api/all reports no featureErrors.
// Run with: npm test
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const PORT = 4790;

test('demo /api/all returns data with no featureErrors', { timeout: 60_000 }, async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'demo', 'run.js'), '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  t.after(() => { child.kill('SIGTERM'); });

  const deadline = Date.now() + 45_000;
  let data = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/all`);
      if (res.ok) { data = await res.json(); break; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }

  assert.ok(data, `demo server did not answer /api/all in time.\nstderr:\n${stderr}`);
  assert.deepEqual(data.featureErrors, {}, 'every feature module loaded cleanly');
  assert.ok(data.config, 'config section present');
  assert.ok(Array.isArray(data.commands), 'commands list present');
});
