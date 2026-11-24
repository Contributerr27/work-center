// Built-in terminal: one shared PTY session (Claude Code by default) bridged to the UI over a WebSocket.
// The session outlives browser reconnects; its last ~200 KB of output is replayed to each new client.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { env: baseEnv } = require('./collect');

const SCROLLBACK = 200 * 1024;
const WS_PATH = '/term';

const modDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const vendorFiles = {
  '/vendor/xterm.js': path.join(modDir('@xterm/xterm'), 'lib', 'xterm.js'),
  '/vendor/xterm.css': path.join(modDir('@xterm/xterm'), 'css', 'xterm.css'),
  '/vendor/addon-fit.js': path.join(modDir('@xterm/addon-fit'), 'lib', 'addon-fit.js'),
};

// Prebuilt node-pty packages sometimes ship spawn-helper without +x, which makes every spawn fail.
function fixSpawnHelper(root) {
  if (process.platform !== 'darwin') return;
  for (const arch of ['darwin-arm64', 'darwin-x64']) {
    for (const dir of [path.join(root, 'prebuilds', arch), path.join(root, 'build', 'Release')]) {
      const helper = path.join(dir.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked'), 'spawn-helper');
      try {
        const { mode } = fs.statSync(helper);
        if ((mode & 0o111) !== 0o111) fs.chmodSync(helper, mode | 0o755);
      } catch { /* missing or read-only (signed bundle): nothing to do */ }
    }
  }
}

let pty = null;
function loadPty() {
  if (pty) return pty;
  fixSpawnHelper(modDir('node-pty'));
  pty = require('node-pty');
  return pty;
}

const expand = (p) => (p ? p.replace(/^~(?=\/|$)/, os.homedir()) : p);
// Two sessions, side by side: "ai" (the AI CLI, e.g. claude) and "shell" (your login shell, for things like
// `gcloud auth login` that open the browser). Each keeps running and replays its scrollback on reconnect.
const sessions = {};
let baseOpts = null;
function session(kind) {
  const k = kind === 'shell' ? 'shell' : 'ai';
  if (!sessions[k]) sessions[k] = { kind: k, proc: null, buf: '', clients: new Set(), cols: 120, rows: 32 };
  return sessions[k];
}
function optsFor(st) {
  if (st.kind === 'shell') return { cwd: '~', command: process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'), args: process.platform === 'win32' ? [] : ['-l'], env: baseOpts?.env || {} };
  return baseOpts;
}

function broadcast(st, msg) {
  for (const ws of st.clients) if (ws.readyState === 1) ws.send(msg);
}

function spawnSession(st) {
  if (st.proc) return st.proc;
  const { cwd, command, args, env } = optsFor(st);
  let dir = expand(cwd) || os.homedir();
  try { if (!fs.statSync(dir).isDirectory()) dir = os.homedir(); } catch { dir = os.homedir(); }
  const procEnv = { ...baseEnv, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete procEnv.ELECTRON_RUN_AS_NODE; // never leak Electron's node mode into child tools
  const cmd = typeof command === 'function' ? command() : command;
  let proc;
  try {
    proc = loadPty().spawn(cmd, args, { name: 'xterm-256color', cols: st.cols, rows: st.rows, cwd: dir, env: procEnv });
  } catch (e) {
    const msg = `\r\n\x1b[31mCould not start ${cmd}: ${e.message}\x1b[0m\r\n`;
    st.buf += msg;
    broadcast(st, msg);
    broadcast(st, JSON.stringify({ t: 'exit', code: -1 }));
    return null;
  }
  st.proc = proc;
  proc.onData((d) => {
    st.buf += d;
    if (st.buf.length > SCROLLBACK * 1.25) st.buf = st.buf.slice(-SCROLLBACK);
    broadcast(st, d);
  });
  proc.onExit(({ exitCode }) => {
    if (st.proc !== proc) return;
    st.proc = null;
    const msg = `\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`;
    st.buf += msg;
    broadcast(st, msg);
    broadcast(st, JSON.stringify({ t: 'exit', code: exitCode }));
  });
  return proc;
}

function stopSession(st) {
  const p = st.proc;
  st.proc = null;
  if (p) try { p.kill(); } catch { /* already gone */ }
}
function stopTerminal() { for (const st of Object.values(sessions)) stopSession(st); }

function onMessage(st, raw) {
  let m;
  try { m = JSON.parse(String(raw)); } catch { return; }
  if (m.t === 'in' && typeof m.d === 'string') {
    (st.proc || spawnSession(st))?.write(m.d);
  } else if (m.t === 'resize') {
    const cols = Math.max(2, Math.min(1000, m.cols | 0));
    const rows = Math.max(2, Math.min(500, m.rows | 0));
    st.cols = cols;
    st.rows = rows;
    if (st.proc) try { st.proc.resize(cols, rows); } catch { /* exited */ }
  } else if (m.t === 'restart') {
    stopSession(st);
    st.buf = '\x1b[2J\x1b[3J\x1b[H';
    broadcast(st, st.buf);
    spawnSession(st);
  }
}

function attachTerminal(httpServer, { allow, token, cwd, command = 'claude', args = [], env = {} } = {}) {
  baseOpts = { cwd, command, args, env };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== WS_PATH) return; // leave other upgrade paths to other handlers
    if (!token || url.searchParams.get('token') !== token || (allow && !allow(req))) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const st = session(url.searchParams.get('kind'));
    wss.handleUpgrade(req, socket, head, (ws) => {
      st.clients.add(ws);
      if (st.buf) ws.send(st.buf);
      if (!st.proc) spawnSession(st);
      ws.on('message', (raw) => onMessage(st, raw));
      ws.on('close', () => st.clients.delete(ws));
      ws.on('error', () => st.clients.delete(ws));
    });
  });
  return wss;
}

// electron-builder afterPack hook (package.json build.afterPack): make sure the packaged
// spawn-helper is executable before the app is signed.
async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = fs.readdirSync(ctx.appOutDir).find((f) => f.endsWith('.app'));
  if (!app) return;
  fixSpawnHelper(path.join(ctx.appOutDir, app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty'));
}

module.exports = { attachTerminal, stopTerminal, vendorFiles, default: afterPack };
