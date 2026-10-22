#!/bin/sh
# Builds the demo home from the fixture. The take runs Claude Code with this
# folder as HOME, so ~/agent-sessions and ~/Developer/my-awesome-lib in the
# recording are demo folders, and nothing of the real home shows or changes.
set -eu
TAPES=$(cd "$(dirname "$0")" && pwd)
DEMO_HOME=${AGENT_HISTORY_DEMO_HOME:-/tmp/agent-history-demo}

# What the last take left goes to the trash where there is one.
if [ -e "$DEMO_HOME" ]; then
  if command -v trash >/dev/null 2>&1; then trash "$DEMO_HOME"; else rm -rf "$DEMO_HOME"; fi
fi
mkdir -p "$DEMO_HOME"
# The physical path, so Claude Code and the shell agree on it (on macOS, /tmp is /private/tmp).
DEMO_HOME=$(cd "$DEMO_HOME" && pwd -P)
LIB="$DEMO_HOME/Developer/my-awesome-lib"
SESSIONS="$DEMO_HOME/agent-sessions"
REMOTE="$DEMO_HOME/remotes/agent-sessions.git"

# The login: on macOS, Claude Code reads it from the login keychain, which it
# finds under ~/Library. Elsewhere it is in ~/.claude/.credentials.json.
if [ -d "$HOME/Library/Keychains" ]; then
  mkdir -p "$DEMO_HOME/Library"
  ln -s "$HOME/Library/Keychains" "$DEMO_HOME/Library/Keychains"
fi
mkdir -p "$DEMO_HOME/.claude"
if [ -f "$HOME/.claude/.credentials.json" ]; then
  ln -s "$HOME/.claude/.credentials.json" "$DEMO_HOME/.claude/.credentials.json"
fi

# Claude Code's own state: onboarding done, the sample repository trusted, a
# pane width that leaves room for the chat, and every notice, hint and upsell
# marked as seen, so the start screen shows only the header.
# Claude Code's own theme follows the terminal theme: light for a theme in
# settings/ whose name ends in -light (record.sh writes the name to .theme-name).
case $(cat "$TAPES/.theme-name" 2>/dev/null) in *-light) claude_theme=light ;; *) claude_theme=dark ;; esac
version=$(claude --version | cut -d' ' -f1)
cat > "$DEMO_HOME/.claude.json" <<EOF
{
  "hasCompletedOnboarding": true,
  "lastOnboardingVersion": "$version",
  "lastReleaseNotesSeen": "$version",
  "theme": "$claude_theme",
  "autoUpdates": false,
  "fullscreenUpsellSeenCount": 3,
  "autoPermissionsNotificationCount": 3,
  "hasSeenAutoDefaultNotice": true,
  "promoStartupSeenCount": 3,
  "effortCalloutV2Dismissed": true,
  "passesUpsellSeenCount": 4,
  "passesLastSeenRemaining": 3,
  "remoteControlUpsellSeenCount": 3,
  "remoteDialogSeen": true,
  "pushNotifUpsellSeenCount": 3,
  "rcLongTurnNudgeSeenCount": 5,
  "rcLongTurnNudgeSeenKey": "v1",
  "hasSeenTasksHint": true,
  "ideHintShownCount": 5,
  "lspRecommendationIgnoredCount": 2,
  "hasSeenAutoModeEntryWarning": true,
  "numStartups": 100,
  "lastClawdEntranceVersion": "$version",
  "announcementImpressions": { "opus-5-5-launch": 10, "opus-5-5-update": 3, "fable-5-1-launch": 5 },
  "projects": { "$LIB": { "hasTrustDialogAccepted": true } },
  "pluginPanes": { "dockColumns": 72 }
}
EOF
# The fullscreen renderer puts a plugin pane beside the chat. The auto mode
# prompt counts as accepted. The mod exports to ~/agent-sessions and commits a
# few seconds after a turn, so the take shows the commit and the push.
cat > "$DEMO_HOME/.claude/settings.json" <<'EOF'
{
  "tui": "fullscreen",
  "skipAutoPermissionPrompt": true,
  "promptSuggestionEnabled": false,
  "pluginConfigs": {
    "agent-history@inline": { "options": { "exportDir": "~/agent-sessions", "commitDelaySeconds": 5 } }
  }
}
EOF

# A demo git identity, for the sample repository and the commits of the mod,
# and no pager, so git log in the take prints and returns to the shell.
cat > "$DEMO_HOME/.gitconfig" <<'EOF'
[user]
	name = Demo
	email = demo@example.com
[init]
	defaultBranch = main
[core]
	pager = cat
EOF
export HOME="$DEMO_HOME" GIT_AUTHOR_DATE=2026-09-22T09:00:00Z GIT_COMMITTER_DATE=2026-09-22T09:00:00Z

# The sample repository, with one commit so the model sees a clean tree.
mkdir -p "$LIB"
cp -R "$TAPES/fixture/my-awesome-lib/." "$LIB/"
git -C "$LIB" init -q
git -C "$LIB" add -A
git -C "$LIB" commit -q -m 'feat: retry helper'

# The export folder: a git repository with one commit, and a bare repository
# in the demo home as its remote, so the push stays on this machine.
git init -q --bare "$REMOTE"
mkdir -p "$SESSIONS"
printf '# Agent sessions\n' > "$SESSIONS/README.md"
git -C "$SESSIONS" init -q
git -C "$SESSIONS" add -A
git -C "$SESSIONS" commit -q -m 'chore: start the history'
git -C "$SESSIONS" remote add origin "$REMOTE"
git -C "$SESSIONS" push -q -u origin main
