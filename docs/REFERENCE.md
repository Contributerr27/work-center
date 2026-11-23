# Work Center reference

Everything Work Center does, section by section. For an overview, see the [README](../README.md).

## Run

```bash
npm install
npm start        # desktop app (Electron: macOS, Windows, Linux)
npm run web      # same page in your browser, no Electron needed
npm run dist:mac # builds dist/mac-arm64/Work Center.app (copy it to ~/Applications)
```

Run from source, macOS labels the app "Electron"; the built **Work Center.app** carries its own name and icon.
App data (AI parts, PRD summaries, ticks) lives in `dataDir` from `config.json`, outside the app bundle.

## How it gets data

| Area | Source | When |
|---|---|---|
| GitHub PRs, review requests | `gh` CLI | live, on open and on Refresh |
| Jira PRDs in QA, mentions, sprint, bugs | `twg` CLI | live, on open and on Refresh |
| PR verdicts, Slack follow-ups, meeting prep, standup, test ideas, next steps | Claude, written to `data/parts/*.json` | the AI scan |

The AI scan follows `prompts/briefing.md`. Run it from the **✦ AI scan** button (needs the
Claude Code CLI logged in: `claude auth login`) or from a scheduled Claude task that follows the
same prompt each morning.

## Actions

- **Merge** squash-merges a PR in the configured repo. It is enabled only when the AI verdict
  says merge and the live checks agree (not a draft, CI green, mergeable); the server re-checks before merging.
- **Nudge**, **Copy draft**, **Copy reply** copy a ready message; **Open** jumps to the thread or ticket.
- **✓** hides an item; ticks on next steps are remembered (`data/state.json`).
- **Read mode** shows the standup status in large type.
- **PRDs in QA review** show where QA stands for each PRD:
  - *Not started* → **✦ Start QA work** runs the AI on your PRD workflow (`prd.skill`, an amem skill) for that PRD
    (checks your sources and the code first; writes the test plan, test cases,
    PM comment, tickets, and automates Ready cases). It runs in the background from the QA repo (`jira.qaWorkDir`).
  - *QA work done · waiting for PM approval* → **✦ Continue** picks up PM answers.
  - *Done and approved* (QA Status Test Plan Approved or later) → **Move to Engineering →** moves the PRD to
    PLANNED (IN ENG BACKLOG). The server re-reads the ticket and refuses unless it is approved and still in QA review.
  - **View work** opens a summary with visuals: QA stepper, test-case split, pass/fail, edge-case matrix,
    tickets, PRs, open questions, next steps and timeline. **✦ Build summary** (read-only) creates it.

Nothing is sent to Slack by the app; in Jira it only moves an approved PRD when you press the button. Your settings (repo, JQL, nudge thresholds) are in `~/.daily-hq/settings.json`; edit them in ⚙ Settings.

## Work Center flow, AI commands and look

- **Steps.** The day runs as five steps (Pull requests → Jira → Slack → Work → Meetings). The current step is open,
  the rest are folded; **✓ Done · next** moves on, **Skip for now** parks a step until the others are finished, and a
  meeting starting within 20 minutes jumps Meetings to the front. **Show all** unfolds everything.
- **AI command bar.** Every section has a box to tell Claude what to do there, plus preset buttons
  (for example **✦ Review & approve all** for PRs). Commands run in the background with the Claude Code CLI
  and report back under the bar. Presets that act outside the app (approve, merge, comment, send, create) ask first.
- **Look.** **Normal look / Vice look** switches themes. To use your own backdrop in the Vice look, save a picture as
  `wallpaper.jpg` (or `.png` / `.webp`) in the data folder (`dataDir` in `config.json`). `build/make-bg.js` repaints the built-in one.

## Command center extras

- **✦ and ＋ on every item.** ✦ puts the item (Slack message, PR, ticket, idea, meeting) on that section's AI bar as a
  chip, so your next message is about it; answers show as a chat and **Follow up** keeps the conversation going
  (`claude --resume`). ＋ has Claude read the item, the whole thread and linked docs (Notion, Jira, GitHub…) and plan a
  step-by-step task under **Mission 4 → My tasks** (files in `data/tasks/`). Planning is read-only.
- **Slack phone.** Every 5 minutes on weekdays 8:00–19:00 a small-model scan (`prompts/slack-scan.md`, about $0.06 a
  run) looks for new DMs, mentions and thread replies that need you. New ones ring the phone (bottom right) and a macOS
  notification, and land in Mission 3. Settings: `slackScan` in `~/.daily-hq/settings.json` (`enabled`, `everyMinutes`, hours, `model`).
- **🏆 Score.** Today / Week / Month scoreboard: Respect score and rank, PRs opened / reviewed / merged, stories done,
  bugs filed and your open bugs by priority (`src/stats.js`, `public/stats.js`).
- **⌨ Terminal** (Cmd+Shift+T). Claude Code in a themed terminal inside the app, started in `terminalCwd`
  (defaults to `jira.qaWorkDir`). The session stays alive while the app runs.
- AI commands run detached and log to `data/commands/`, so they keep going and still report back if the app restarts.

## Control center (round 4)

- **Menu bar + hotkey.** Work Center lives in the menu bar (count of what is waiting + workload stars). Closing the window
  keeps it running; Cmd+Q quits. **Cmd+Shift+Space** from any app opens quick capture: Enter = AI command, Cmd+Enter = task.
  Config: `hotkey`, `launchAtLogin` (off by default; also a menu checkbox), `morningScan` (runs the AI scan once each
  weekday morning if the briefing is stale).
- **Mission 2 · Damage Report** (`src/features/health.js`): nightly / scheduled workflows of the e2e repo as status
  lights with a 10-run strip, failing tests by suite with flaky and new badges, Testera self-heal PRs. ✦ Triage
  (read-only), Rerun (asks first). Testera data needs `TESTERA_API_KEY` in the app's environment.
- **🤖 Autopilot** (`src/features/autopilot.js`): standing rules run on a schedule, each in its mission's live feed;
  big Pause-all kill switch. Five templates ship switched off (approve dependency bumps, ship my green e2e PRs, nudge
  quiet bugs, after-meeting tasks, refresh Slack summary). Rules marked ⚠ act outside the app and ask before enabling.
- **Email and invites on the phone** (`src/features/mail.js`, `prompts/mail-scan.md`): Gmail threads that need a
  reply every 15 minutes (`mailScan` in config, about $0.03 a check), shown with ✉ and also in Mission 3 (Messages).
  Calendar invites (📅) get Accept / Maybe / Decline — only for the calendar that is connected.
- **🌇 Wrap up** (`src/features/wrap.js`): Mission summary of the day; ✦ Write my wrap logs the work to amem, drafts
  tomorrow's standup, suggests Jira updates (posted only when you press Post), and on Fridays drafts the weekly report.
- **🎯 Focus** (`src/features/focus.js`): 25/50/90-minute focus missions on a task with a countdown HUD; only urgent
  messages ring the phone; every 25 focused minutes adds 2 Respect. Optional `focus.onStart` / `focus.onEnd` shell
  commands (e.g. `shortcuts run 'Work Focus On'`) toggle macOS Focus.
- New features plug in as files: see `docs/FEATURES.md`.

## Works for anyone

`config.json` ships generic defaults only. Everything about the person lives in `~/.daily-hq/settings.json`
(override the folder with `DAILYHQ_HOME`); data defaults to `~/.daily-hq/data`.

- **⚙ Settings / first run:** finds the AI tools on the machine (Claude Code, Claude app, Cursor, Gemini CLI,
  Codex/ChatGPT, Windsurf, Copilot CLI, VS Code, opencode, Aider, Ollama), their MCP servers and account
  connectors, and the rule files written for them (CLAUDE.md, GEMINI.md, AGENTS.md, Cursor/Windsurf rules).
  "Set me up" installs and connects amem, reads the Claude/git/GitHub identity, and has the AI fill the
  profile (role, company, main repo, Jira site, Slack ids, work folder). Only empty fields are filled.
- **AI engine** (`ai.engine`): Claude Code, Cursor Agent, Gemini CLI or Codex; automatic picks the first one
  installed. Claude Code is the reference engine (live step feed, follow-up chats, small model for scans).
- **Rules:** `ai.rules` plus any shared rule files (`ai.shareInstructions`) are added to every AI prompt.
- **AI Center:** every AI run by day (`data/history/YYYY-MM-DD.jsonl`), month calendar, full transcripts.
- **✦ bubble (⌘J):** chat or terminal, small/medium/full, file and image attachments (`data/uploads`).
- **⌂ Home:** streak, rank, today at a glance, 30-day stats, 18-week activity map, AI actions, wins.
- **Themes:** Normal, Vice, Winter. Add one in `THEMES` (public/flow.js) plus a `:root[data-theme=…]` block.
- **◫ Projects:** one project per Jira epic you own, report, or work under, by quarter (from a "26Q4" / "Q4 2026"
  tag in the title, the due date, or when it was resolved; open work always shows in the current quarter). Stories
  and tasks with deadlines (due date, else sprint end), progress, blockers (blocked status, flagged, "is blocked by",
  late), linked PRs, an AI brief of the conversation around it (read-only), and an AI assistant scoped to it.
  The ◫ button on any Jira item on the desk opens its project. Settings `projects`: `epicJql`,
  `includeParentsOfMine`, `sprintField`, `flaggedField`, `cacheMinutes`. Home shows this quarter's projects.
- **🧭 Growth & HR:** org chart, a self-review written from your Jira, GitHub, work log, Slack and meeting notes for
  a period (copy each answer), and AI feedback with a 0–100 score across seven areas from your work and your
  manager conversations, with suggested improvements and a coach chat. Settings `hr`: `manager`, `reviewQuestions`,
  `ratingScale`, `focus`. All of it stays in `data/hr` on this computer.
- **♪ Music:** a side panel (under Messages in the sidebar) with what's playing on Spotify, play/pause/skip, the
  playlists and albums you played last, and your own playlists. Connect once with your own Spotify developer
  app's Client ID (PKCE login in the browser, no client secret); the refresh token is encrypted with the macOS
  Keychain in `data/music.json`. Playing goes to the Spotify desktop app when it's installed (free or Premium),
  otherwise to your open Spotify device through the Web API (Premium), otherwise the playlist opens in Spotify.
- **◎ amem:** when the [amem](https://github.com/sslugic/amem) CLI is installed, a sidebar button opens amem's live
  Activity view (what your AI tools save and recall) in a side panel, on the left or right (switch in its header).
  Work Center starts `amem ui` in the background if it isn't running. Setting `amem.uiPort` (default 7843).
- **👥 Team:** AI teammates, each with a charter, a queue of real work (Jira JQL, GitHub searches, your epics, or
  work described in words), a playbook, a schedule, an autonomy level (observe, draft and ask, act) and a daily budget.
  Each shift reports what it works on, what is blocked and what is next. Outward steps it recommends land in **Signals**
  as Approve / Decline (approving runs exactly that action); its questions wait in the AI chat with an answer box.
  Teammates hand work to each other, own Autopilot rules, keep notes in amem, and get a weekly scorecard and your
  👍 / 👎 corrections. Four starters ship switched off (Metis, Odysseus, Perseus, Athena). Data: data/team/.
- **Meetings:** a few minutes before a meeting (`meetingAlerts.minutesBefore`, default 2) a macOS notification and a
  card in the window offer **Join here**: the call (Google Meet, Zoom web client, Teams, Webex) opens in a side panel
  with its own saved sign-in, camera and microphone. **Leave** ends the call; **Open in browser** hands it off. The
  15-minute email and calendar check also picks up meetings added during the day. `meetingAlerts.enabled` turns it off.
- **Speed:** GitHub and Jira lists, stats, projects and tool detection are kept in `data/cache/` and shown at once,
  even right after a restart, then refreshed in the background (lists every 2 minutes while open, every 5 otherwise).
  A failed refresh keeps the last good copy, marked stale. **Refresh** still waits for fresh data.

## Themes

Pick a theme from **Theme** in the sidebar. Anyone can make and share new ones (a folder with `theme.json`, optional CSS and pictures, no code); see [THEMES.md](../THEMES.md). The example `theme-packs/aurora` ships with the app.
