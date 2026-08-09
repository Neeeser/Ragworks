#!/usr/bin/env python3
"""PreToolUse hook: reject unbounded background Bash polling loops.

A backgrounded `until`/`while` + `sleep` loop keyed on a sentinel the watched
process may never print runs until the session ends, piling up as an orphaned
task. Foreground loops are capped by the Bash tool timeout and cannot orphan,
so only `run_in_background` calls are inspected — which also keeps commit
messages, greps, and heredocs that merely contain the loop text from tripping.
A `timeout N` wrapper makes the loop self-limiting and is allowed.
"""

import json
import re
import sys

# `;` or a newline before `do`, so multi-line loops do not escape; bounded
# gaps keep the match local to one loop header.
POLL_LOOP = re.compile(r"\b(?:until|while)\b[^\n]{0,200}?(?:;|\n)\s*do\b[\s\S]{0,300}?\bsleep\b")
BOUNDED = re.compile(r"\bg?timeout\s+\d")

MESSAGE = """Unbounded background polling loops are blocked. Options, best first:
- Long command (make verify, pytest, npm run verify): run THE COMMAND ITSELF with run_in_background — the harness notifies you when it exits. Append `; echo exit=$?` if you need the status. Do not background a command and then background a loop watching its output file.
- CI: `gh pr checks <pr> --watch --fail-fast` in the background — exits when checks settle.
- `uv run python -m sandbox up <scenario>` exits once servers are healthy — run it foreground with a 600000ms timeout.
- Readiness/liveness waits that must poll: run them in the FOREGROUND (capped at 600000ms), or wrap in `timeout <seconds> bash -c '...'` to background them."""


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    if payload.get("tool_name") != "Bash":
        return 0
    tool_input = payload.get("tool_input", {})
    if not tool_input.get("run_in_background"):
        return 0
    command = tool_input.get("command", "")
    if POLL_LOOP.search(command) and not BOUNDED.search(command):
        print(MESSAGE, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
