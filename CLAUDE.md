# agent-history

A Claude Code mod. The README describes what it does.

## Checks

Run `pnpm check` (validate and test) after each change. The pre-commit hook also runs it.

## After a push

Claude Code runs the copy of the mod that it made at install time, not this folder. After each push to `main`, always update the local installation:

```
claude plugin update agent-history@zirkelc
```

Then tell the user to run `/reload-plugins`, so the running sessions load the new version.
