Work Center setup. Work out who this person is and how their work is wired, so their dashboard can show
their own pull requests, tickets, messages and meetings. Strictly read-only: never send, post, comment,
create, edit or move anything anywhere. Use few tool calls; skip any source you cannot reach.

Already known (keep these unless they are clearly wrong): {{KNOWN}}
Connections you can use: {{CONNECTIONS}}

Find, from their own accounts:
- name, work email, job title/role, company: Slack profile, calendar or email account, GitHub profile, `git config`.
- GitHub: login (`gh api user`), the orgs they work in (`gh api user/orgs`), and their main repository: the
  repo in their work org with the most PRs they authored or reviewed in the last 60 days
  (`gh search prs --author=@me --limit 100 --json repository,updatedAt`, and `--reviewed-by=@me`).
- A local clone of that main repo: look only in common folders (~/code, ~/src, ~/dev, ~/Development,
  ~/projects, ~/GitHub*, ~/repos, ~/workspace, ~/Documents/GitHub), at most 4 levels deep, matching the
  git remote. Use its absolute path.
- Jira: the Atlassian site URL they use (for example https://acme.atlassian.net), if any.
- Slack: their own Slack user id (U…), the team id (T…) and the workspace domain (acme.slack.com), if
  Slack is connected.

Your final answer must be ONLY this JSON (no prose, no code fence). Use null for anything you could not
confirm; never guess an id.
{"owner": {"name": null, "email": null, "role": null, "company": null, "slackId": null, "slackTeamId": null, "slackDomain": null},
 "github": {"login": null, "repo": "owner/name or null", "orgs": []},
 "jira": {"site": null},
 "workDir": null,
 "notes": "one short line: what you could not reach, if anything"}
