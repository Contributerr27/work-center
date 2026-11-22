# Writing a Work Center feature

Work Center is a local Electron app (`main.js`) wrapping a Node server (`src/server.js`, plain `http`, no framework)
that serves a vanilla-JS page (`public/`). The day is a flow of "missions" (steps); each mission has an AI command bar
whose commands run the Claude Code CLI in the background with a live step feed. Read README.md first.

## Where your code goes

- Server: `src/features/<name>.js`, CommonJS, `module.exports = { setup(ctx) { ... } }`. Loaded automatically at start.
- Page: `public/features/<name>.js` and `public/features/<name>.css`. Loaded automatically after the core scripts
  (classic scripts, run in file-name order). Do not edit core files (`src/server.js`, `public/app.js`, `flow.js`,
  `hq.js`, `index.html`, `app.css`); if you truly need a core change, say so in your report instead.
- State files go under `ctx.DATA` (outside the app bundle): e.g. `path.join(ctx.DATA, '<name>.json')`.

## Server context (`ctx`)

| Field | Use |
|---|---|
| `config`, `ROOT`, `DATA`, `PARTS`, `TASK_DIR`, `env`, `expand(p)`, `token` | config.json, paths, CLI env (PATH finds `gh`, `twg`, `claude`), `~` expansion |
| `route(method, path, async ({ url, body, req }) => result)` | add an API route. POSTs need the page token (the page's `post()` helper sends it). Return JSON, or `{ status, body }`. Throw `Object.assign(new Error(msg), { status })` for errors |
| `provide(name, async () => data)` | data included in every `/api/all` as `D.ext[name]` (keep it fast, cache yourself) |
| `addSection(id, name, dataFn)` | register a new mission id for AI commands; `dataFn()` returns what the AI sees as "what the section shows" |
| `runCommand(section, text, { ref, thread })` | start an AI run (Claude Code CLI, auto permission mode, in the QA repo). It appears in that mission's live feed. Returns the command `{ id, ... }` |
| `stopCommand(id)`, `commands()` | stop a run; list runs (`running`, `startedAt`, `section`, `result`, `error`, `actions`) |
| `createTask(section, ref)`, `readTasks()`, `writeTask(task)` | Mission 4 task list. Task file: `{ id (10 hex), status: planning|ready|failed, title, source: { section, label, url, who }, createdAt, summary, due, priority: P0|P1|P2, steps: [{ text, done }], links: [{ label, url }] }` |
| `addPings(items, { source, mission3, silent })` | ring the phone + macOS notification. Item: `{ who, channel, when, kind: reply|follow-up|ask|fyi|invite|alert, urgency 1-3, summary (≤90 chars), url, draft, source }`. Deduped by url |
| `notify(title, body)` | native notification only |
| `readState()`, `writeState(st)` | `data/state.json` (`st.done[id] = isoTime` ticks) |
| `briefing()`, `live(force)` | AI briefing parts (`prs`, `slack`, `meetings`, `work`) and live GitHub/Jira data |

Long jobs: start AI work with `runCommand` (it is detached and survives app restarts). For timers use
`setInterval(..., ms).unref()`. Never block the event loop; wrap CLI calls with `execFile` and a timeout.

## Page globals

- `D` — last `/api/all` payload (`D.live`, `D.ai`, `D.ext`, `D.commands`, `D.tasks`, `D.pings`, `D.state`, `D.token`).
- `h(tag, attrs, ...kids)` — element builder (text is always inserted as text, never HTML); `$(id)`;
  `post(path, body)` (token-checked POST, throws on error); `toast(msg)`; `load(force)` (refetch + render);
  `render()`; `panel(title, count, body, extraButtons)`; `empty(msg)`; `avatar(name)`; `time(iso)`; `ring(done, total)`;
  `age(days)`; `itemActions(sectionId, ref)` (✦ ask AI / ＋ task buttons); `askAbout(sectionId, ref, prefill)`;
  `liveFeed(command)`; `celebrate({ name, mission })` ("Mission passed" splash); `theme()` → `'vice'|'normal'`.
- `HQ.addMission({ id, sec, name, mission, at: 'HH:MM', ph, presets: [[label, prompt, warnOrNull]], after: '<mission id>', render(box), count(), load() })`
  — adds a step to the day flow with its own AI bar; `render(box)` fills `box` on every page render; `count()` is the
  number on its tile; `load()` its workload points for the header stars (roughly 1 point per item that needs attention).
  A preset with a warning string asks before running (use it for anything that writes outside the app).
- `HQ.addButton({ id, label, title, onclick })`, `HQ.onRender(fn)`, `HQ.overlay(id)` / `HQ.closeOverlay(id)`.
- Existing mission ids: `github`, `jira`, `slack`, `work`, `meet`.

## Look

Two themes on `<html data-theme>`: `vice` (default; neon dusk: purple panels with blur, pink `#ff2e93`, orange
`#ff7a3d`, cyan `#4fd8ff`, yellow `#ffd23f`, green `#3dffb0`; headings in "Avenir Next Condensed", italic, uppercase) and
`normal` (clean). Use the CSS variables in `public/app.css` (`--panel`, `--line`, `--text`, `--muted`, `--soft`,
`--green`, `--amber`, `--red`, `--blue`, `--violet` and their `-bg` variants) and reuse classes `.panel`, `.btn`,
`.btn.sm`, `.btn.go`, `.btn.ghost`, `.pill` (+ `green|amber|red|blue|violet`), `.row`, `.grid.g2`, `.empty`.
No gradient text, no thick one-sided accent borders on rounded cards. Visual first, little text. Must work at 900px wide.

## Testing

`node src/server.js` starts a server (it prints its URL; port 4747 is usually taken by the installed app, so it picks a
free port). Do not stop, restart or rebuild the installed app (`~/Applications/Work Center.app`) and do not run
`npm run dist:mac` — the integrator does that. Kill only servers you started. Test read-only against real data;
never approve, merge, comment, send or create anything on GitHub, Jira, Slack, Gmail or Calendar while testing.
