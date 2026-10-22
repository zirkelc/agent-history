#!/bin/sh
# Starts Claude Code in the sample repository of the demo home, with the mod
# from this checkout, auto mode, and none of the real home's settings, plugins,
# MCP servers, CLAUDE.md or memory. Run reset.sh first.
TAPES=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$TAPES/../../.." && pwd)
DEMO_HOME=$(cd "${AGENT_HISTORY_DEMO_HOME:-/tmp/agent-history-demo}" && pwd -P) || exit 1

cd "$DEMO_HOME/Developer/my-awesome-lib" || exit 1
clear
exec env -i HOME="$DEMO_HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TERM="$TERM" \
  LANG=en_US.UTF-8 SHELL=/bin/zsh TMPDIR="$TMPDIR" \
  DISABLE_AUTOUPDATER=1 \
  claude --plugin-dir "$REPO" \
    --strict-mcp-config \
    --permission-mode auto \
    --allowedTools "Edit(/$DEMO_HOME/Developer/my-awesome-lib/**)" \
    "$@"
