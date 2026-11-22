// The AI that does Work Center's work: whichever agent CLI is on this machine. Claude Code is the
// reference engine (live step feed, follow-up chats, small model for scans). Cursor Agent, Gemini
// CLI and Codex work through the same calls; settings `ai.engine` picks one, else the first found.
//   once(prompt, opts)   → { child, parse(stdout) → { text, error, cost, sessionId } }  (scans, setup)
//   stream(prompt, opts) → argv for a detached run whose log the progress feed reads
const { spawn } = require('node:child_process');
const { which } = require('./detect');
const { env } = require('./collect');

const lastJson = (out) => {
  const s = String(out || '');
  try { return JSON.parse(s.slice(s.indexOf('{'))); } catch { /* try line by line */ }
  for (const line of s.trim().split('\n').reverse()) { try { return JSON.parse(line); } catch { /* next */ } }
  return null;
};
// Claude Code and Cursor Agent print the same result object: { result, is_error, session_id, total_cost_usd }.
const claudeLike = (out) => {
  const r = lastJson(out);
  if (!r) return { text: '', error: String(out || '').trim().slice(-300) || 'The AI returned nothing' };
  return { text: String(r.result ?? ''), error: r.is_error ? String(r.result || 'The AI run failed').slice(0, 300) : null, cost: r.total_cost_usd, sessionId: r.session_id || r.chatId || null };
};

const ENGINES = {
  claude: {
    name: 'Claude Code', bin: 'claude', small: 'haiku', instructions: '~/.claude/CLAUDE.md', streams: true, resumes: true,
    once: (prompt, { model, writes } = {}) => ['-p', prompt, '--output-format', 'json', '--permission-mode', writes === 'edits' ? 'acceptEdits' : 'auto', ...(model ? ['--model', model] : [])],
    stream: (prompt, { resume, model, addDir } = {}) => ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', ...(addDir ? ['--add-dir', addDir] : []), ...(resume ? ['--resume', resume] : []), ...(model ? ['--model', model] : [])],
    parse: claudeLike,
  },
  cursor: {
    name: 'Cursor Agent', bin: 'cursor-agent', small: null, instructions: 'Cursor rules', streams: true, resumes: true,
    once: (prompt, { model, addDir } = {}) => ['-p', '--output-format', 'json', '--auto-review', '--trust', '--approve-mcps', ...(addDir ? ['--add-dir', addDir] : []), ...(model ? ['--model', model] : []), prompt],
    stream: (prompt, { resume, model, addDir } = {}) => ['-p', '--output-format', 'stream-json', '--auto-review', '--trust', '--approve-mcps', ...(addDir ? ['--add-dir', addDir] : []), ...(resume ? ['--resume', resume] : []), ...(model ? ['--model', model] : []), prompt],
    parse: claudeLike,
  },
  gemini: {
    name: 'Gemini CLI', bin: 'gemini', small: 'gemini-2.5-flash', instructions: '~/.gemini/GEMINI.md', streams: false, resumes: false,
    once: (prompt, { model } = {}) => ['-p', prompt, '--output-format', 'json', '--approval-mode', 'auto_edit', ...(model ? ['--model', model] : [])],
    stream: (prompt, opts) => ENGINES.gemini.once(prompt, opts),
    parse: (out) => {
      const r = lastJson(out);
      if (!r) return { text: String(out || '').trim(), error: String(out || '').trim() ? null : 'The AI returned nothing' };
      return { text: String(r.response ?? r.result ?? ''), error: r.error ? String(r.error.message || r.error).slice(0, 300) : null };
    },
  },
  codex: {
    name: 'Codex', bin: 'codex', small: null, instructions: '~/.codex/AGENTS.md', streams: false, resumes: false,
    once: (prompt, { model } = {}) => ['exec', '--json', '--full-auto', '--skip-git-repo-check', ...(model ? ['-m', model] : []), prompt],
    stream: (prompt, opts) => ENGINES.codex.once(prompt, opts),
    parse: (out) => {
      // JSONL events; the answer is the last agent message.
      let text = '', error = null;
      for (const line of String(out || '').split('\n')) {
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const item = ev.item || ev.msg || ev;
        if (/agent_message/.test(item.type || '') && (item.text || item.message)) text = item.text || item.message;
        if (/error/.test(ev.type || '')) error = String(ev.message || ev.error?.message || 'Codex failed').slice(0, 300);
      }
      return { text, error: text ? null : error || (String(out).trim() ? null : 'The AI returned nothing') };
    },
  },
};
const TOOL_OF = { claude: 'claude', cursor: 'cursor', gemini: 'gemini', codex: 'codex' };

function pick(config) {
  const want = config.ai?.engine;
  if (want && ENGINES[want] && which(ENGINES[want].bin)) return want;
  return Object.keys(ENGINES).find((id) => which(ENGINES[id].bin)) || null;
}

function current(config) {
  const id = pick(config);
  if (!id) return null;
  const e = ENGINES[id];
  const small = config.ai?.smallModel === undefined ? e.small : config.ai.smallModel || null;
  return { id, tool: TOOL_OF[id], ...e, small, model: config.ai?.model || null };
}

// Spawn one headless run and resolve with the parsed answer.
function runOnce(config, prompt, { small = false, cwd, timeoutMs = 4 * 60_000, writes, addDir, onSpawn } = {}) {
  const e = current(config);
  if (!e) return Promise.resolve({ text: '', error: 'No AI CLI found. Install Claude Code, Cursor, Gemini CLI or Codex, then open Settings.' });
  const model = small ? e.small : e.model;
  return new Promise((resolve) => {
    const child = spawn(e.bin, e.once(prompt, { model, writes, addDir }), { env, cwd });
    onSpawn?.(child);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += e.id === 'claude' ? '' : d));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); resolve({ text: '', error: err.message }); });
    child.on('close', () => { clearTimeout(timer); resolve(e.parse(out)); });
  });
}

module.exports = { ENGINES, current, runOnce, lastJson };
