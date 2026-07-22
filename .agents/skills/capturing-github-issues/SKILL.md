---
name: capturing-github-issues
description: Use when a Ragworks user wants to capture a bug, confusing behavior, incomplete setup, feature request, or technical backlog item as a GitHub issue.
---

# Capturing GitHub Issues

Turn an informal report into a concise, user-approved GitHub issue. By default, capture what the user experienced or wants changed; do not turn the issue into an investigation report or implementation plan.

## Capture the report

Classify the request before drafting:

- **User-facing problem:** Preserve where the user was, what they tried, what happened, why it mattered, and what they expected instead.
- **Product or feature request:** Capture the requested behavior and the reason or design direction the user gave.
- **Technical work item:** Preserve technical wording, names, versions, providers, formats, files, and other context the user supplied or requested.

Edit dictated feedback for readability and concision without replacing its authorship. Preserve first-person language, uncertainty, examples, reasoning, and explicit constraints when material.

## Brainstorm feature requests

When the user is requesting new user-facing behavior, invoke **REQUIRED SUB-SKILL:** `superpowers:brainstorming` before drafting the issue. Use its context exploration, focused clarification questions, multiple-choice options, alternatives, tradeoffs, and design discussion to clarify what the user wants. Continue asking questions until the feature direction is clear enough to capture; do not manufacture ambiguity when the request is already specific.

Stop the brainstorming workflow after the design conversation. Do not write or commit a design document, ask the user to review a spec file, invoke `writing-plans`, or implement the feature. Use the decisions and explicit constraints from the conversation in the issue, without copying the whole brainstorming transcript or rejected alternatives.

Do not invoke brainstorming for a user-facing bug report or maintenance-only technical task such as a version bump or provider migration unless the user asks for design exploration.

## Ask useful questions

Ask follow-up questions whenever ambiguity or missing context could materially change the issue. There is no fixed limit: ask as many focused questions as needed, in one or more messages, and stop when the issue is specific enough to capture accurately.

Prefer multiple-choice questions when the options represent real alternatives. Generate questions from the report and repository reading that helps clarify names, screens, providers, models, configuration relationships, or terminology. Do not use a fixed questionnaire.

For ordinary user-facing or feature reports, repository reading improves wording and questions; it is not permission to diagnose, expand scope, or add unsolicited technical evidence. Do not reproduce or verify by default. If the user explicitly asks for browser or Playwright work, tests, logs, reproduction, or other investigation, follow that request and include relevant findings.

Do not ask for details already supplied or invent setup, root causes, impact, acceptance criteria, or solutions. Preserve unknowns or omit them. If repository evidence conflicts with an explicit request, explain the conflict and ask before changing direction.

## Draft the smallest useful issue

Show a complete draft before creating anything. Choose the smallest structure that captures the report and omit empty sections.

For a user-facing problem:

```markdown
## Problem
<What the user tried, what happened, and why it matters.>

## Expected behavior
<What the user expected or wants instead.>

## Context
<Relevant details supplied by the user or explicitly requested investigation.>
```

For a feature request, include the decisions from brainstorming in a concise `Design direction` section when they materially shape the request. For other requests or technical work items:

```markdown
## Request
<What should be changed or added.>

## Why
<Why the user wants it, when supplied.>

## Context
<Explicit technical details, constraints, or references.>
```

Use first person when it best preserves the report. Keep the title concise and factual. Do not add repository findings, root-cause hypotheses, `Technical context`, `Proposed scope`, or implementation steps unless the user supplied or explicitly requested them. Expected behavior and explicit design direction are requirements, not solutions.

## Format Markdown for GitHub

Before showing or posting the draft:

- Use real line breaks, not literal backslash-n text.
- Strip trailing spaces and tabs from every line.
- Keep exactly one blank line between paragraphs, headings, and list blocks.
- Remove leading and trailing blank lines and end the body with one newline.
- Use fenced code only for user-supplied or explicitly requested code, logs, or structured technical detail.

## Labels, duplicates, and approval

When preparing to post, use only existing repository labels. If repository labels cannot be checked, say so and do not guess. Check for an obvious duplicate when issue-tracker access is available; keep that search out of the body and say when it could not be performed.

Always show the title, complete body, labels, likely duplicates, and explicitly requested links. Ask for approval before creating. Treat “yes,” “go ahead,” “post it,” and similar replies as authorization to create exactly the approved draft; treat corrections as instructions to revise and show it again. Never create from silence or an ambiguous reply.

After creation, return the issue URL and labels applied. If creation or labeling partially fails, report the exact state and do not silently retry with altered content.

## Common mistakes

| Mistake | Correct behavior |
|---|---|
| Turning a complaint into an investigation report | Capture the user’s experience and requested outcome |
| Asking a fixed questionnaire | Generate only questions that resolve meaningful ambiguity |
| Treating a symptom as a root cause | Preserve the symptom and ask for relevant context |
| Removing technical detail the user explicitly requested | Keep the requested wording, files, and references |
| Drafting a feature request before clarifying its design | Invoke `superpowers:brainstorming`, then use the resulting decisions |
| Running browser or test work without being asked | Draft from the report unless investigation was explicitly requested |
| Adding a solution or posting malformed or unapproved Markdown | Describe the request, normalize it, show it, and wait |
