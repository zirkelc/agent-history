# Agent History for Claude Code

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/pane-dark.png" />
  <img src="../assets/pane-light.png" alt="The agent-history panel beside the chat, after a turn: the session, the export folder, the git remote, the formats and the content, and the activity log with the export, the commit and the push" />
</picture>

This folder is the Claude Code plugin of [Agent History](../README.md). It is a [hooks module](https://code.claude.com/docs/en/plugins/mods/overview) that Claude Code loads itself. After each turn, it exports the session and its subagents to a folder you choose, and commits and pushes it when the folder is a git repository.

## Install

```
/plugin marketplace add zirkelc/agent-plugins
/plugin install agent-history@zirkelc
```

Then open `/config`, search for `agent-history`, and set the export folder. The [README](../README.md) describes the settings, the panel and the files.
