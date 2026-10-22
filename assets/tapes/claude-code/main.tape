# The README image: the agent-history panel is open while Claude changes
# retry() in the sample repository. When the turn ends, the mod exports the
# session, and a few seconds later it commits and pushes the export folder.
# Then Claude exits, and the shell shows the exported files in ~/agent-sessions.
Output out/main-raw.mp4
Source .theme.tape
# The terminal only. The window frame is added afterwards.
Set Width 1600
Set Height 1000

Hide
Type "clear && ./reset.sh && export HOME=$(cd /tmp/agent-history-demo && pwd -P) && ./launch.sh"
Enter
Wait+Screen@60s /auto mode on/
Sleep 2s
Show

Sleep 1s
Type "/agent-history"
Sleep 500ms
Enter
Wait+Screen@20s /AGENT HISTORY/
Sleep 1500ms

Type "Add exponential backoff to retry(), with a baseDelayMs option. Keep 3 attempts as the default."
Sleep 500ms
Enter
Wait+Screen@600s /· done /
# The commit delay of the demo is 5 seconds; the push follows the commit.
Wait+Screen@60s /push +origin\/main/
Sleep 3s
Screenshot out/main-pane.png

Type "/exit"
Sleep 500ms
Enter
Wait+Screen@20s /--resume/
Sleep 1500ms

Type "cd ~/agent-sessions"
Sleep 400ms
Enter
Sleep 1s
Type "git log --oneline"
Sleep 400ms
Enter
Sleep 2500ms
Type "tree sessions"
Sleep 400ms
Enter
Sleep 3s
Type "head -12 sessions/*/*.md"
Sleep 400ms
Enter
Sleep 6s
Screenshot out/main-end.png
Sleep 1s
