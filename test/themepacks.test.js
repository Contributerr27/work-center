// Unit tests for src/themepacks.js: pack validation and CSS cleaning.
// Run with: npm test
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Packs install into $DAILYHQ_HOME/themes; point it at a scratch folder before loading the module.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-themes-test-'));
process.env.DAILYHQ_HOME = SCRATCH;
const themepacks = require('../src/themepacks');

// A tiny valid PNG (1x1 transparent) for file-serving tests.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function makePack(id, overrides = {}, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wc-pack-${id}-`));
  const json = { id, name: overrides.name || 'Test Pack', ...overrides };
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(json));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function fakeRes() {
  const r = { status: null, headers: {}, body: '' };
  r.writeHead = (status, headers) => { r.status = status; r.headers = headers || {}; };
  r.end = (body) => { r.body = body || ''; };
  return r;
}

test('a valid pack installs with defaults and lists as installed', () => {
  const page = themepacks.install(makePack('ocean'));
  assert.equal(page.id, 'ocean');
  assert.equal(page.version, '1.0.0');
  assert.equal(page.base, 'normal');
  assert.equal(page.effect.kind, 'none');
  const { packs } = themepacks.list();
  assert.ok(packs.some((p) => p.id === 'ocean' && p.source === 'installed'));
  themepacks.remove('ocean');
  assert.ok(!themepacks.list().packs.some((p) => p.id === 'ocean'));
});

test('a folder without theme.json is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-pack-empty-'));
  assert.throws(() => themepacks.install(dir), /theme\.json is missing or not valid JSON/);
});

test('ids must be 2-31 lowercase letters, digits or dashes', () => {
  assert.throws(() => themepacks.install(makePack('x')), /must be 2.*31/); // too short
  assert.throws(() => themepacks.install(makePack('has space')), /must be 2.*31/);
  assert.throws(() => themepacks.install(makePack('-leading-dash')), /must be 2.*31/);
  // uppercase is normalized, not rejected
  const page = themepacks.install(makePack('Shouty'));
  assert.equal(page.id, 'shouty');
  themepacks.remove('shouty');
});

test('built-in theme ids are reserved', () => {
  for (const id of ['normal', 'vice', 'winter']) {
    assert.throws(() => themepacks.install(makePack(id)), /built-in theme/);
  }
});

test('token values with css escapes, urls or braces are dropped', () => {
  const page = themepacks.install(makePack('tokens-pack', {
    tokens: {
      '--accent': '#fff',
      '--bad-url': 'url(https://evil.example/x.css)',
      '--bad-expression': 'expression(alert(1))',
      '--bad-brace': 'red; } body { display:none',
      '--bad-import': '@import "x.css"',
    },
  }));
  themepacks.remove('tokens-pack');
  const { packs } = themepacks.list();
  assert.ok(!packs.some((p) => p.id === 'tokens-pack'));
  // inspect through a fresh install: only the clean token survives
  const dir = makePack('tokens-check', {
    tokens: { '--accent': '#fff', '--bad': 'url(https://evil.example)' },
  });
  themepacks.install(dir);
  const found = themepacks.find('tokens-check');
  assert.deepEqual(Object.keys(found.tokens), ['--accent']);
  themepacks.remove('tokens-check');
  assert.ok(page);
});

test('css cleaning removes @import and remote urls, keeps data urls, rewrites local files', () => {
  const css = [
    '@import url("https://evil.example/remote.css");',
    '.a { background: url("https://evil.example/x.png"); }',
    '.b { background: url("//cdn.example/y.png"); }',
    '.c { background: url("/etc/passwd"); }',
    '.d { background: url("data:image/png;base64,AAAA"); }',
    '.e { background: url("logo.png"); }',
  ].join('\n');
  themepacks.install(makePack('css-pack', {}, { 'theme.css': css, 'logo.png': PNG }));

  const res = fakeRes();
  assert.equal(themepacks.serve('/theme-pack/css-pack.css', res), true);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/css/);
  assert.ok(!/@import\s+url/.test(res.body), '@import rule removed');
  assert.match(res.body, /@import removed/);
  assert.ok(!res.body.includes('evil.example/x.png'), 'remote url neutralized');
  assert.ok(!res.body.includes('cdn.example/y.png'), 'protocol-relative url neutralized');
  assert.ok(!res.body.includes('/etc/passwd'), 'absolute path neutralized');
  assert.ok(res.body.includes('data:image/png;base64,AAAA'), 'data url kept');
  assert.ok(res.body.includes('/theme-pack/css-pack/logo.png'), 'local file rewritten into the pack route');
  themepacks.remove('css-pack');
});

test('urls escaping the pack folder are neutralized', () => {
  themepacks.install(makePack('trav-pack', {}, { 'theme.css': '.x { background: url("../secret.png"); }' }));
  const res = fakeRes();
  themepacks.serve('/theme-pack/trav-pack.css', res);
  assert.ok(!res.body.includes('secret.png'));
  assert.ok(res.body.includes('about:invalid'));
  themepacks.remove('trav-pack');
});

test('serving an unknown theme answers 404', () => {
  const res = fakeRes();
  assert.equal(themepacks.serve('/theme-pack/nope.css', res), true);
  assert.equal(res.status, 404);
});

test('only installed themes can be removed', () => {
  assert.throws(() => themepacks.remove('never-installed'), /Only installed themes/);
  assert.throws(() => themepacks.remove('BAD ID!'), /Unknown theme/);
});
