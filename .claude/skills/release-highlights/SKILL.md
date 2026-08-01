---
name: release-highlights
description: >-
  Use when cutting a Ragworks release or drafting release notes — the user asks to
  bump a version, write release highlights, or summarize what changed since the
  last release. Covers surveying merged work, drafting the Highlights section in
  the repo's voice, and the bump command that seeds it into the release PR.
---

# Release highlights

How a Ragworks release gets its notes. The mechanics: `make
bump-patch|bump-minor|bump-major|bump-rc` (or the **Open release PR**
workflow-dispatch) opens a release PR whose body carries a `## Highlights`
section; merging the PR publishes the release with that section on top,
followed by GitHub's generated PR list (`breaking`/`feature`/`fix` PRs only —
`.github/release.yml` excludes the rest). The section stays editable on the PR
until merge; `HIGHLIGHTS="…"` on the make command (or the workflow's
`highlights` input) pre-fills it.

## Drafting the highlights

1. **Survey the span.** `git fetch --tags origin`, find the last tag
   (`git tag --sort=-creatordate | head -1`), then read every subject:
   `git log <tag>..origin/main --pretty='%s'`. Read the PR descriptions of
   anything whose subject alone doesn't explain it.
2. **Cluster into themes**, not PRs. A release with 50 commits has 4–7
   highlights; group by what a self-hoster experiences (one console redesign,
   not nine UI PRs). Ignore `docs`/`ci`/`chore`/`dependencies` work — it is
   excluded from the notes and doesn't belong in highlights either.
3. **Order by impact.** Biggest user-visible change first; operational and
   internal-architecture items last. A security-relevant fix (anything about
   account isolation, credential handling, or data exposure) gets its own
   sentence plus a plain upgrade recommendation — never buried in a cluster.
4. **Pick the bump level from the span**: `breaking`-labeled PRs → major (while
   pre-1.0, minor); any `feature` → minor; fixes only → patch.

## Voice

The audience is technical self-hosters reading a GitHub release page. Same
register as the root `AGENTS.md` writing-voice rule — engineering
documentation, not a product pitch — applied to changelogs:

- **Flat bullets, no bolded topic labels, no intro sentence.** Each bullet is
  1–3 plain sentences stating what changed and, where it isn't obvious, what
  that enables.
- **Concrete nouns over evaluative adjectives.** Name the mechanism
  (`Streamable HTTP`, `self.<field>`, dialects) — the audience can parse it,
  and it carries more information than "powerful" or "seamless" ever would.
  Banned: marketing adjectives, "now even better", exclamation points.
- **State scope honestly.** "Redesigned the console: new visual system across
  all pages" — not "a beautiful new experience". If a feature has a limit
  (backend-gated, pgvector-only), say so in the bullet.
- Past-tense or noun-phrase openings both work ("Added OpenAI…", "Structured
  JSON logging with…"); keep one style per draft.

Example bullet, calibrated:

> - Unified tools and pipelines: search, count, and BM25 facet tools are
>   pipelines with their own editor, templates, and a tool-runner search page.
>   Ports are typed by data shape instead of pipeline stage, and node config
>   fields support expressions, including sibling references via `self.<field>`.

## Shipping it

Draft the bullets, get the user's sign-off on the text, then hand them the
command (run from a clean `main` checkout):

```bash
make bump-minor HIGHLIGHTS="- First bullet.
- Second bullet."
```

The value passes as an env var, so quotes and apostrophes in prose are safe;
avoid backticks and `$` in the shell form (edit those in on the PR instead, or
use the workflow-dispatch input, which takes the text verbatim). The user can
still edit the section on the release PR before merging — the workflow reads
it from the PR body at merge time.

## Editing this skill

Author here, then mirror: `cp -R .claude/skills/release-highlights/.
.agents/skills/release-highlights/` and verify with
`diff -r .claude/skills/release-highlights .agents/skills/release-highlights
&& echo "in sync"`.
