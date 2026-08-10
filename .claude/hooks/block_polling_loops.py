#!/usr/bin/env python3
"""PreToolUse hook: reject unbounded Bash polling loops.

An `until`/`while` + `sleep` loop keyed on a sentinel the watched process may
never print runs until the session ends. A foreground loop orphans just as
readily as a backgrounded one: the Bash tool moves any foreground command that
exceeds its timeout into the background, where the loop keeps polling for
hours. Both are rejected; wrapping the loop in `timeout` bounds it and passes.

Quoted spans and heredoc bodies are stripped before matching, so a commit
message, `grep` pattern, or heredoc that merely contains the loop text is not
mistaken for a loop — a real loop's keywords sit outside quotes.
"""

import json
import re
import sys

HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1(.*?)^\s*\2\s*$", re.DOTALL | re.MULTILINE)
SINGLE_QUOTED = re.compile(r"'[^']*'")
DOUBLE_QUOTED = re.compile(r'"(?:\\.|[^"\\])*"')
POLL_LOOP = re.compile(r"\b(?:until|while)\b[^\n]{0,200}?(?:;|\n)\s*do\b[\s\S]{0,300}?\bsleep\b")
BOUNDED = re.compile(r"\bg?timeout\s+\d")

MESSAGE = """Unbounded polling loops are blocked (foreground too — the Bash tool moves a timed-out foreground command into the background, where the loop keeps polling for hours). Options, best first:
- Long command (make verify, pytest, npm run verify, playwright): run THE COMMAND ITSELF with run_in_background — the harness notifies you when it exits. Append `; echo exit=$?` if you need the status. Do not background a command and then poll its output file.
- CI: `gh pr checks <pr> --watch --fail-fast` in the background — exits when checks settle.
- `uv run python -m sandbox up <scenario>` exits once servers are healthy — just run it.
- A wait that genuinely must poll (service readiness, a process exiting): give it a deadline — `timeout <seconds> bash -c '...'`."""


def strip_literals(command: str) -> str:
    """Remove heredoc bodies and quoted spans so only real shell syntax remains."""
    without_heredocs = HEREDOC.sub("", command)
    without_single = SINGLE_QUOTED.sub("''", without_heredocs)
    return DOUBLE_QUOTED.sub('""', without_single)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    if payload.get("tool_name") != "Bash":
        return 0
    command = payload.get("tool_input", {}).get("command", "")
    code = strip_literals(command)
    if POLL_LOOP.search(code) and not BOUNDED.search(code):
        sys.stderr.write(MESSAGE + "\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
