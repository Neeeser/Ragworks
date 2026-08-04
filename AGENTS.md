# Ragworks

Read @CLAUDE.md in full before making changes — it holds the repo-wide rules.

Area rules live in `.claude/rules/`. Read the file for the code you touch
(Claude Code loads these automatically via their `paths:` frontmatter):

| Touching | Read |
| --- | --- |
| `app/`, `tests/` (any backend work) | `.claude/rules/backend.md` |
| `app/pipelines/`, `app/prompting/`, `app/evals/` | + `.claude/rules/pipelines.md` |
| `app/vectorstores/`, `app/providers/`, `app/clients/` | + `.claude/rules/integrations.md` |
| `frontend/` | `.claude/rules/frontend.md` |
| `sandbox/`, `frontend/flows/` | `.claude/rules/sandbox.md` |
