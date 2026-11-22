// Live progress for AI runs. Claude runs with `--output-format stream-json --verbose`, which writes one
// JSON event per line. This turns that log into a step feed and spots finished actions (PR approved or
// merged, Jira comment or move, Slack reply sent) so the desk can tick items off while the run goes on.
const fs = require('node:fs');
const path = require('node:path');

const sizes = new Map(); // log path -> size already parsed, so unchanged logs are skipped

function toolLabel(name, input = {}) {
  if (name === 'Bash') return input.description || `$ ${String(input.command || '').split('\n')[0].slice(0, 90)}`;
  if (name === 'Read') return `Reading ${path.basename(input.file_path || '')}`;
  if (name === 'Write' || name === 'Edit') return `Writing ${path.basename(input.file_path || '')}`;
  if (name === 'Grep' || name === 'Glob') return `Searching ${input.pattern || ''}`.slice(0, 90);
  if (name === 'Task' || name === 'Agent') return `Helper: ${input.description || 'subtask'}`;
  if (name === 'ToolSearch') return 'Loading tools';
  if (name === 'WebFetch' || name === 'WebSearch') return `Web: ${input.url || input.query || ''}`.slice(0, 90);
  if (name.startsWith('mcp__')) {
    const t = name.split('__').pop().replace(/_/g, ' ');
    const q = input.query || input.jql || input.issueIdOrKey || input.channel_id || '';
    return `${t}${q ? `: ${q}` : ''}`.slice(0, 100);
  }
  return name;
}

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c.text || '').join('\n') : '');

// Actions read from what a tool actually returned, so a failed call never ticks anything off.
function actionsFrom(name, input, out) {
  const acts = [];
  for (const m of out.matchAll(/Approved pull request ([\w.-]+\/[\w.-]+)#(\d+)/g)) acts.push({ kind: 'approved', key: `${m[1]}#${m[2]}` });
  for (const m of out.matchAll(/(?:Squashed and merged|Rebased and merged|Merged) pull request ([\w.-]+\/[\w.-]+)#(\d+)/g)) acts.push({ kind: 'merged', key: `${m[1]}#${m[2]}` });
  if (/"state":\s*"APPROVED"/.test(out)) {
    const m = out.match(/repos\/([\w.-]+\/[\w.-]+)\/pulls\/(\d+)/);
    if (m) acts.push({ kind: 'approved', key: `${m[1]}#${m[2]}` });
  }
  const cmd = String(input.command || '');
  const jiraKey = input.issueIdOrKey || (cmd.match(/--(?:id|key)\s+([A-Z][A-Z0-9]+-\d+)/) || [])[1];
  if (jiraKey && (/addCommentToJiraIssue/.test(name) || /twg jira workitem comment/.test(cmd))) acts.push({ kind: 'commented', key: jiraKey });
  if (jiraKey && (/transitionJiraIssue/.test(name) || /twg jira workitem transition/.test(cmd))) acts.push({ kind: 'moved', key: jiraKey });
  // Calendar RSVP that went through (Notion Calendar or Google Calendar connector).
  const rsvp = (input.updates || []).find((u) => u?.updateType === 'RSVP')?.rsvp?.responseStatus || (/respond_to_event$/.test(name) && (input.response || input.responseStatus));
  if (rsvp && /notion-calendar-update-events$|respond_to_event$/.test(name) && !/error|not found|failed|denied|forbidden/i.test(out.slice(0, 400))) acts.push({ kind: 'rsvp', key: String(rsvp) });
  if (/slack_send_message$/.test(name) && input.channel_id) acts.push({ kind: 'sent', key: `${input.channel_id}:${input.thread_ts || ''}` });
  return acts;
}

function parseProgress(cmd) {
  if (!cmd.log) return false;
  let size;
  try { size = fs.statSync(cmd.log).size; } catch { return false; }
  if (sizes.get(cmd.log) === size && cmd.activity) return false;
  sizes.set(cmd.log, size);
  let raw = '';
  try { raw = fs.readFileSync(cmd.log, 'utf8'); } catch { return false; }
  const pending = new Map();
  const activity = [];
  const actions = [];
  let tools = 0, now = null, result = null;
  for (const line of raw.split('\n')) {
    if (line[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content || []) {
        if (c.type === 'text' && c.text.trim()) activity.push({ kind: 'text', label: c.text.trim().split('\n')[0].slice(0, 160), sub: !!ev.parent_tool_use_id });
        if (c.type === 'tool_use') {
          tools++;
          const item = { kind: 'tool', label: toolLabel(c.name, c.input), sub: !!ev.parent_tool_use_id };
          activity.push(item);
          pending.set(c.id, { item, name: c.name, input: c.input || {} });
        }
      }
    } else if (ev.type === 'user') {
      for (const c of ev.message?.content || []) {
        const p = c.type === 'tool_result' && pending.get(c.tool_use_id);
        if (!p) continue;
        p.item.done = true;
        if (c.is_error) p.item.failed = true;
        else actions.push(...actionsFrom(p.name, p.input, textOf(c.content)));
      }
    } else if (ev.type === 'system' && ev.subtype === 'task_summary' && ev.detail) {
      now = ev.detail;
    } else if (ev.type === 'result' || ('total_cost_usd' in ev && 'session_id' in ev)) {
      result = ev;
    }
  }
  const seen = new Set();
  cmd.actions = actions.filter((a) => !seen.has(`${a.kind}:${a.key}`) && seen.add(`${a.kind}:${a.key}`));
  cmd.activity = activity.slice(-14);
  cmd.steps = tools;
  cmd.now = now;
  cmd._result = result;
  return true;
}

// The final event of a run (or, for logs written before streaming, the single JSON object).
function finalResult(cmd, raw) {
  if (cmd._result) return cmd._result;
  try { return JSON.parse(raw.slice(raw.indexOf('{'))); } catch { return null; }
}

// The whole run as a readable transcript for the AI Center: what the AI said, every tool it used
// (and whether it failed), and the final answer. Logs from engines without a step stream come back
// as one text block.
function transcript(raw) {
  const out = [];
  const pending = new Map();
  let result = null;
  let structured = false;
  for (const line of String(raw || '').split('\n')) {
    if (line[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    structured = true;
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content || []) {
        if (c.type === 'text' && c.text.trim()) out.push({ kind: 'text', text: c.text.trim().slice(0, 4000), sub: !!ev.parent_tool_use_id });
        if (c.type === 'tool_use') {
          const item = { kind: 'tool', label: toolLabel(c.name, c.input), tool: c.name, sub: !!ev.parent_tool_use_id };
          out.push(item);
          pending.set(c.id, item);
        }
      }
    } else if (ev.type === 'user') {
      for (const c of ev.message?.content || []) {
        const item = c.type === 'tool_result' && pending.get(c.tool_use_id);
        if (!item) continue;
        item.done = true;
        if (c.is_error) { item.failed = true; item.error = textOf(c.content).slice(0, 300); }
      }
    } else if (ev.type === 'result') {
      result = ev;
    }
  }
  if (!structured && String(raw || '').trim()) out.push({ kind: 'text', text: String(raw).trim().slice(-6000) });
  return { steps: out.slice(-400), result: result ? { text: String(result.result || ''), error: !!result.is_error, cost: result.total_cost_usd, turns: result.num_turns, ms: result.duration_ms } : null };
}

module.exports = { parseProgress, finalResult, transcript };
