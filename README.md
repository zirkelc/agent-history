# Agent History

A Claude Code mod that keeps a history of your sessions. After each turn, it exports the session and its subagents to a folder you choose. When that folder is a git repository, the mod commits the export and pushes it.

- **Formats:** JSONL (raw or filtered) and/or Markdown, plus a `meta.json` file for each session.
- **Filters:** keep only the content you want (text, tool calls, tool input, tool results, thinking, meta rows), so the files stay small.
- **Secrets redacted:** API keys, tokens, passwords and private keys are replaced with `[REDACTED:<kind>]` before a file is written, so they do not get into the git history. On by default.
- **Git is optional:** a plain folder gets the export only. A repository gets a commit. A repository with a remote also gets a push.
- **Self-contained:** everything runs in Claude Code's lifecycle hooks. No launchd jobs, no cron, no settings hooks.

## Install

Type these commands at the prompt of a Claude Code terminal session:

```
/plugin marketplace add zirkelc/agent-plugins
/plugin install agent-history@zirkelc
```

Select a scope (user scope is the default), then set the export folder on the settings screen.

## Settings

Open `/config` and search for `agent-history` to change the settings.

| Setting | Default | What it does |
| --- | --- | --- |
| Export folder | (none) | Absolute path or `~/...` of the folder to export to. Until it is set, nothing is exported and the status line asks you to set it |
| Export JSONL | on | Write `<uuid>.jsonl` for each session and subagent |
| Export Markdown | on | Write `<uuid>.md` for each session and subagent |
| Include text | on | Keep the text of user and assistant messages |
| Include tool calls | on | Keep each tool call with its tool name |
| Include tool input | off | Keep the input of each tool call |
| Include tool results | off | Keep tool results (the largest part of a transcript) |
| Include thinking | off | Keep thinking blocks |
| Include meta rows | off | Keep rows Claude Code adds itself (reminders, attachments, system rows) |
| Redact secrets | on | Replace secrets in the exported files with `[REDACTED:<kind>]` (see below) |
| Push after commit | on | Push each commit when the repository has a remote |
| Commit delay (seconds) | 60 | Wait this long after the last export, so turns close together make one commit |

With every content filter on, the JSONL file is the raw transcript, with only the secrets replaced.

### Secret redaction

Claude Code keeps each transcript in plaintext under `~/.claude/projects`, with everything you pasted and every tool output. The mod scans each exported file and replaces these secrets with `[REDACTED:<kind>]`:

| Kind | What it finds |
| --- | --- |
| `private-key` | PEM private key blocks |
| `anthropic`, `openai` | `sk-ant-…` and `sk-…` API keys |
| `github` | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` and `github_pat_` tokens |
| `aws` | AWS access key IDs (`AKIA…`, `ASIA…`) |
| `google` | Google API keys (`AIza…`) |
| `stripe` | Stripe secret and restricted keys |
| `slack`, `slack-webhook` | Slack tokens (`xox…-`) and webhook URLs |
| `npm` | npm tokens |
| `jwt` | JSON Web Tokens |
| `bearer` | The token after `Bearer` |
| `url-password` | The password in a URL such as `postgres://user:password@host` |
| `assignment` | The value of a name with `key`, `secret`, `token`, `password` or `credential` in it, when the value has letters and digits and is 12 or more characters long |

The name before a secret stays, for example `API_KEY=[REDACTED:assignment]`. Placeholders such as `${TOKEN}`, `<your-key>` and `process.env.X` stay as they are. The activity log in the panel shows how many secrets each export redacted.

The redaction applies to the exported files only. The transcripts of Claude Code stay as they are, and files that were exported before you turned redaction on are not changed. The scan uses patterns, so it can miss a secret in an unknown format. If you pasted a secret into a session, rotate it.

## Usage

| Command | What it does |
| --- | --- |
| `/agent-history` | Opens the panel |

The panel shows the export folder, the git state, the formats and the content filters, and a log of each export, commit and push. It has these actions:

- **⇅ Sync now:** commit and push the pending exports at once (shown when the folder is a git repository).
- **+ Init git repo:** run `git init` in the export folder (shown when the folder is not a repository). The mod never runs `git init` by itself.
- **✕ Close:** close the panel (or press Esc).

The mod shows a status line only when there is a problem, for example `push failed` or `no remote`. The mod never creates a remote. To push, add one yourself, for example with `gh repo create <name> --private --source <folder> --push`.

## When it runs

| Hook | What happens |
| --- | --- |
| `session.start` | Read the git state of the export folder and register the command |
| `classic.Stop` (end of each turn) | Export the session |
| `classic.SubagentStop` (end of each subagent) | Export the subagent |
| Timer, 60 s after the last export | Commit and push |
| `session.end` | Export, commit and push at once |

## Layout

```
<export folder>
└── sessions
    └── <session-id>
        ├── <session-id>.jsonl
        ├── <session-id>.md
        ├── <session-id>.meta.json
        └── agents
            ├── <agent-id>.jsonl
            └── <agent-id>.md
```

### Examples

These examples show one short session with the default settings (text and tool calls, no tool input, no tool results, no thinking, no meta rows).

**`<session-id>.meta.json`** holds the facts of the session, its subagents, and the export settings that made the files:

```json
{
  "sessionId": "0b7c8e2a-4f1d-4c3a-9e6b-2d5f8a1c7e90",
  "cwd": "/Users/me/Developer/my-app",
  "git": {
    "repo": "my-app",
    "branch": "main",
    "worktree": "/Users/me/Developer/my-app"
  },
  "startedAt": "2026-10-12T09:00:00.000Z",
  "updatedAt": "2026-10-12T09:00:05.000Z",
  "turns": 1,
  "agents": [
    {
      "agentId": "a1b2c3d4e5f6a7b8c",
      "agentType": "Explore",
      "startedAt": "2026-10-12T09:00:02.000Z",
      "updatedAt": "2026-10-12T09:00:04.000Z",
      "turns": 1
    }
  ],
  "export": {
    "formats": ["jsonl", "markdown"],
    "filters": {
      "text": true,
      "toolUse": true,
      "toolInput": false,
      "toolResults": false,
      "thinking": false,
      "meta": false
    },
    "redactSecrets": true,
    "exportedAt": "2026-10-12T09:00:06.000Z"
  }
}
```

`git` is `null` when the session ran outside a git repository.

**`<session-id>.jsonl`** has one message on each line. With every filter on, it is the raw transcript. Otherwise each line keeps only `type`, `uuid`, `timestamp`, `cwd`, `gitBranch` and the `message` with the content you selected:

```jsonl
{"type":"user","uuid":"5d1e…","timestamp":"2026-10-12T09:00:00.000Z","cwd":"/Users/me/Developer/my-app","gitBranch":"main","message":{"role":"user","content":"Why does the login test fail?"}}
{"type":"assistant","uuid":"8f3a…","timestamp":"2026-10-12T09:00:01.000Z","cwd":"/Users/me/Developer/my-app","gitBranch":"main","message":{"role":"assistant","model":"claude-opus-5-5","content":[{"type":"text","text":"I will look at the test first."},{"type":"tool_use","id":"toolu_01…","name":"Read"}]}}
{"type":"assistant","uuid":"c47b…","timestamp":"2026-10-12T09:00:05.000Z","cwd":"/Users/me/Developer/my-app","gitBranch":"main","message":{"role":"assistant","model":"claude-opus-5-5","content":[{"type":"text","text":"The test uses an expired token. I updated the fixture."}]}}
```

**`<session-id>.md`** has one section for each run of messages from the same role. A tool call shows its name. With tool input on, the input follows in a JSON block. Tool results and thinking show in a collapsed `<details>` block:

```markdown
## User - 2026-10-12T09:00:00.000Z

Why does the login test fail?

## Assistant - 2026-10-12T09:00:01.000Z

I will look at the test first.

_[Tool: Read]_

The test uses an expired token. I updated the fixture.
```

**`agents/<agent-id>.jsonl`** and **`agents/<agent-id>.md`** have the same format as the session files, for the transcript of one subagent.

## Development

```
pnpm install
pnpm check
```

`pnpm check` runs `claude plugin validate .` and `claude plugin test .`. `pnpm install` also sets up a git pre-commit hook (with `simple-git-hooks`) that runs `pnpm check` before each commit.

## License

MIT
