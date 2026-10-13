# agent-history

A Claude Code mod. The README describes what it does.

## Checks

Run `pnpm check` (validate and test) after each change. The pre-commit hook also runs it.

## Release

Claude Code runs the copy of the mod that it made at install time, not this folder. It updates that copy only when the `version` in `.claude-plugin/plugin.json` changes, not on each commit.

1. When a change touches the shipped files (`hooks`, `types`, `.claude-plugin`), raise `version` in `.claude-plugin/plugin.json` and `package.json`. CI fails when shipped files changed after the last version change.
2. Push to `main`.
3. Update the local installation:

   ```
   claude plugin update agent-history@zirkelc
   ```

4. Tell the user to run `/reload-plugins`, so the running sessions load the new version.
