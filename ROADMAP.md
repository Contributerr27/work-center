# Roadmap

Work Center began as one engineer's morning routine, so today it fits engineering and QA best. The goal is a
morning command center for **any** role, still using only the AI and logins people already have.

Each item below is a GitHub issue with a user story, the sections to build and a definition of done. Pick one,
comment that you're on it, and open a pull request. `npm run demo` gives you made-up data to work against.

## 1. Foundations for other roles

These come first: they let a role pack be mostly configuration instead of code.

| Issue | What |
|---|---|
| [#1 Role packs](https://github.com/sslugic/work-center/issues/1) | Pick your role in Settings; the day flow shows that role's sections, order and wording |
| [#2 AI-sourced sections](https://github.com/sslugic/work-center/issues/2) | Add a section with a prompt and a field list, with no code |
| [#3 Connectors](https://github.com/sslugic/work-center/issues/3) | A connector interface; Linear, GitLab and Jira through its API next to `gh` and `twg` |
| [#4 Calendar and email](https://github.com/sslugic/work-center/issues/4) | Today's meetings and important mail before the AI scan runs |

## 2. Role packs

Each one lists its sections, data sources and AI presets.

| Issue | For |
|---|---|
| [#5](https://github.com/sslugic/work-center/issues/5) | Engineering and people managers: team pulse, waiting on me, 1:1 prep, delivery risk |
| [#6](https://github.com/sslugic/work-center/issues/6) | Sales: pipeline today, follow-ups, call prep, CRM updates, quota |
| [#7](https://github.com/sslugic/work-center/issues/7) | Customer support and success: SLA queue, reply drafts, escalations, accounts at risk |
| [#8](https://github.com/sslugic/work-center/issues/8) | Product managers: decisions, delivery, customer signal, metrics, launches |
| [#9](https://github.com/sslugic/work-center/issues/9) | HR, people and recruiting: candidates, employee requests, cycles, onboarding |
| [#10](https://github.com/sslugic/work-center/issues/10) | Designers: feedback, handoffs, crits |
| [#11](https://github.com/sslugic/work-center/issues/11) | Marketing: content calendar, performance, approvals |
| [#12](https://github.com/sslugic/work-center/issues/12) | Founders and executives: company brief, decisions, people |

Missing your role? Open an issue with the same shape: who it's for, three to five sections, where the data
comes from, and the AI buttons you'd want.

## 3. Everyone

| Issue | What |
|---|---|
| [#13](https://github.com/sslugic/work-center/issues/13) | Windows and Linux builds |
| [#14](https://github.com/sslugic/work-center/issues/14) | Automated tests and CI (good first issue) |
| [#15](https://github.com/sslugic/work-center/issues/15) | More theme packs (good first issue; [docs/THEME-AI.md](docs/THEME-AI.md) makes it quick) |

## Principles

- **Use what's there.** No new accounts or stored tokens: the person's AI tool, its connectors and their CLI logins.
- **Local first.** Data stays in `~/.daily-hq`. Nothing is sent or changed outside the app without a button press,
  and the AI asks before any outward action.
- **Visual, short, in order.** A section earns its place by saving minutes every morning.
- **Plug in, don't fork.** Features, sections, themes and role packs are files dropped in, not edits to the core.
