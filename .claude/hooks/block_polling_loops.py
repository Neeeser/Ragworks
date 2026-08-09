#!/usr/bin/env python3
"""PreToolUse hook: reject Bash polling loops (`until`/`while` + `sleep`).

A sleep-polling loop spawned as a background task runs until its sentinel
appears; when the watched process fails without printing it, the loop runs
forever and piles up as an orphaned background task. Every wait this repo
needs has a built-in replacement, named in the rejection message.
"""

import json
import re
import sys

# Requires the shell loop shape (`until COND; do … sleep`) so prose or log
# text merely mentioning the words does not trip the hook.
POLL_LOOP = re.compile(r"\b(until|while)\b[^\n;]*;\s*do\b[^\n]*?\bsleep\b")

MESSAGE = """Polling loops (until/while + sleep) are blocked in this repo. Use the built-in wait instead:
- Long command (make verify, pytest, npm run verify): run THE COMMAND ITSELF with run_in_background — the harness notifies you when it exits. Append `; echo exit=$?` if you need the status in the log. No watcher task.
- CI: run `gh pr checks <pr> --watch --fail-fast` in the background — it exits when checks settle.
- Watching a log or endpoint for a condition: use the Monitor tool, not a Bash loop.
- `uv run python -m sandbox up <scenario>` already exits once servers are healthy — run it foreground with a 600000ms timeout."""


def main() -> int:
    payload = json.load(sys.stdin)
    if payload.get("tool_name") != "Bash":
        return 0
    command = payload.get("tool_input", {}).get("command", "")
    if POLL_LOOP.search(command):
        print(MESSAGE, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
