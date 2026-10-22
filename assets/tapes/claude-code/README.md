# Claude Code recordings

The tape in this folder records the images in the [README](../../../README.md) with [vhs](https://github.com/charmbracelet/vhs). It is a live take: the agent-history panel is open while Claude Code adds exponential backoff to `retry()` in a sample repository. When the turn ends, the panel logs the export, and 5 seconds later the commit and the push. Then Claude exits, and the shell shows `git log`, the tree of the export folder and the start of the exported Markdown.

## Record

```sh
./record.sh               # both README sets: Graphite Dark and Graphite Light
./record.sh <name>        # one theme: settings/<name>.tape
```

It needs `vhs`, `ttyd`, `ffmpeg`, `git`, `tree` and Claude Code with a login. It takes about 100 seconds and one model turn of 20 to 35 seconds for each theme, on the account that Claude Code is logged in with. Each take is different, so look at the results before you use them, and run again if you do not like one.

The results go to `out/<theme>/`:

| File | What it shows |
| --- | --- |
| `main-dark.gif`, `main-light.gif` (and `.mp4`) | The take in a window, sped up where the model works |
| `main-raw.mp4`, `main-plain.mp4` | The take at normal speed, and sped up with no window |
| `main-pane-*.png` | The panel after the push |
| `main-end-*.png` | The shell at the end |

The dark theme (`graphite-dark`) gives the `-dark` files, and the light theme (`graphite-light`) the `-light` files. The screenshots also come as `-plain`, with no window. To use them, copy them to `assets/`: `main-<mode>.gif` to `session-<mode>.gif`, and `main-pane-<mode>.png` to `pane-<mode>.png`. The README shows the version that matches the reader's GitHub theme.

## How it works

- **Demo home.** `reset.sh` builds a new home folder in `/tmp/agent-history-demo` (set `AGENT_HISTORY_DEMO_HOME` to use another one): the sample repository from `fixture/` in `~/Developer/my-awesome-lib` with one commit, the export folder `~/agent-sessions` as a git repository with one commit, and a bare repository in `~/remotes` as its remote `origin`, so the push stays on this machine. A demo `~/.gitconfig` gives the commits the name `Demo` and turns the pager off. The take runs Claude Code and the shell with this folder as `HOME`, so the real home is never read or changed.
- **Login.** Claude Code finds its login on macOS in the login keychain under `~/Library/Keychains`, and elsewhere in `~/.claude/.credentials.json`. `reset.sh` links that one item into the demo home. Nothing else of the real home is in it.
- **Claude Code state.** `reset.sh` writes the demo home's `~/.claude.json` (onboarding done, the sample repository trusted, a pane width of 72 columns, and the notices, hints and promos of a new install marked as seen) and `~/.claude/settings.json` (the fullscreen renderer, which puts the pane beside the chat, auto mode accepted, no prompt suggestions, and the options of the mod: the export folder `~/agent-sessions` and a commit delay of 5 seconds). If a new version of Claude Code shows a new notice on the start screen, find its key in a `~/.claude.json` that has seen it, and add it to `reset.sh`.
- **Launch.** `launch.sh` starts Claude Code in the sample repository with a clean environment, the mod from this checkout (`--plugin-dir` at `claude-code/`), no MCP servers and auto mode.
- **Speed.** `record.sh` plays the part where the model works 5 times faster. It starts 9 seconds into the take and ends 28 seconds before the end, because everything after the turn has fixed waits (the commit delay and the shell). If a later version of Claude Code changes these times, find the new ones on frames of the raw take and change the numbers in `record.sh`.
- **Look.** `settings/<theme>.tape` sets the font and the theme. `graphite-dark` has the colors of Atom, and `graphite-light` the colors of Atom One Light. Each has the background of a plugin pane in Claude Code's dark or light theme, so the pane and the terminal have one color. For a theme whose name ends in `-light`, `reset.sh` also sets Claude Code's own theme to light. The tape sets the size after it: 1600×1000, so the pane has room beside the chat.
- **Window.** vhs draws no window title, so the take has no window, and `record.sh` puts each output into one with [`../frame/frame.sh`](../frame): a macOS title bar with a title (`TITLE`, default `agent-history`), rounded corners and a margin of 24 pixels in GitHub's dark (`#0d1117`) or light (`#ffffff`) page color. The title bar is dark for a dark theme and light for a light theme.
