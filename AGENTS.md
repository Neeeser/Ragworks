# Ragworks — instructions for coding agents

This file is a pointer, not a rulebook: every rule lives in `CLAUDE.md` and
`.claude/rules/`, stated once, so nothing here can drift from them.

**Read `CLAUDE.md` in full before starting.** It holds the repo-wide rules — verify
gates, commit and PR conventions, releases, the two runtime modes, configuration
architecture — and they apply to every change.

`CLAUDE.md` opens with a table mapping directories to area rule files in
`.claude/rules/`. Read the file covering the code you are about to touch before
writing any, and read both when a change spans two areas. Claude Code loads them
automatically from their `paths:` frontmatter; agents without path-scoped rules open
them as ordinary files.

Area rules extend `CLAUDE.md`; they never replace it.
