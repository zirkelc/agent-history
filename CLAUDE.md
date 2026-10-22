# agent-history

A Claude Code mod. The README describes what it does.

## Checks

Run `pnpm check` (validate and test) after each change. The pre-commit hook also runs it.

## Test in a live session

The tests do not show the layout. After a change to what the mod draws, test it in a live session:

1. Open a new terminal that runs Claude Code with the mod loaded from the folder you work in:

   ```
   claude --plugin-dir <path to this folder>/claude-code
   ```

   This loads the files as they are in that folder, also changes that are not committed.

2. Tell the user that the terminal is open, and what to look at.

## Release

Claude Code runs the copy of the mod that it made at install time, not this folder. It updates that copy only when the `version` in `claude-code/.claude-plugin/plugin.json` changes, not on each commit.

1. When a change touches the shipped files (everything in `claude-code/`), raise `version` in `claude-code/.claude-plugin/plugin.json` and `package.json`. CI fails when shipped files changed after the last version change.
2. Push to `main`.
3. Update the local installation:

   ```
   claude plugin update agent-history@zirkelc
   ```

4. Tell the user to run `/reload-plugins`, so the running sessions load the new version.
