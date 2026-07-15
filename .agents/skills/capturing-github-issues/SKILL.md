---
name: capturing-github-issues
description: Use when a Ragworks user reports confusing, broken, frustrating, or incomplete setup or product behavior and wants that feedback investigated, drafted, tracked, or opened as a GitHub issue.
---

# Capturing GitHub Issues

Turn informal feedback into an actionable Ragworks issue without losing the experience that exposed it or the product direction the user specified. Keep user experience, explicit decisions, repository evidence, and technical hypotheses distinct.

## Intake

Start from the user's account. Preserve concrete language such as “this felt broken” when it accurately describes the experience; do not sanitize it into a purely technical summary.

Edit dictated feedback for readability, structure, and concision, not for authorship. Remove filler words, repair transcription errors, and organize repeated thoughts, but preserve the user's causal narrative, reasoning, uncertainty, emphasis, examples, and design philosophy. Keep the experience recognizably theirs.

Do not replace a first-person incident with generic product language. When the user explains how an experience led to a design conclusion, retain both the incident and that reasoning chain. Use first person in `User experience` when it is the clearest faithful representation of the report; an issue does not need to sound impersonal to be technically useful.

Treat explicit product decisions, design decisions, visual references, constraints, and requested implementation direction as requirements for the issue draft. Preserve named components, locations, interaction patterns, reuse requirements, and other material details. Do not silently omit, generalize, or replace them while translating the report into technical language.

Challenge a decision when repository evidence reveals a conflict, material risk, or infeasible constraint. State the evidence and ask before changing the direction. Do not recast a deliberate decision as an optional idea merely because another implementation appears more conventional.

If the report already identifies where it happened, what the user expected, and what happened instead, investigate immediately. If a consequential detail is missing, use **REQUIRED SUB-SKILL:** `superpowers:brainstorming`. Ask one focused question at a time about the location, expected result, actual result, setup, recovery path, or impact. Do not ask for details that repository evidence can answer, and do not over-interview an actionable report.

## Ground the report

Investigate proportionally before drafting:

1. Read the root `AGENTS.md` and the relevant area `AGENTS.md`.
2. Inspect nearby code, tests, documentation, and recent related history. Do not implement a fix.
3. Search open and closed GitHub issues for duplicates or closely related work.
4. Read the repository's current labels and suggest only labels that exist.
5. Link relevant repository files or documentation with GitHub URLs. Prefer stable commit permalinks when line-level evidence matters.

State confirmed facts directly. Mark plausible explanations as hypotheses. Do not promote the user's guess, or your own, into a root cause. A broad refactor belongs in the issue only when repository evidence supports that scope; otherwise describe the required outcome and leave implementation open.

This evidence rule applies to inferred technical scope, not to explicit owner direction. Preserve the user's requested design direction even when the implementation details remain open.

## Draft on the first substantive response

Present the most sensible complete issue draft as soon as the report is actionable. Do not respond only with a plan to investigate. If genuinely different issue boundaries are plausible, briefly offer the sensible alternatives and recommend one.

Use this shape, omitting only sections that do not apply:

```markdown
Title: <concise, factual description of the affected behavior>
Labels: <existing label>, <existing label>

## User experience
<Where the user was, what they were trying to do, how the behavior felt,
and the practical impact. Preserve the causal story and reasoning that
motivated the issue; polish dictated language without replacing its author.>

## Observed behavior
<What happened, including reproduction or setup context when known.>

## Expected behavior
<What a user should be able to understand or accomplish instead.>

## Product and design direction
<The user's explicit product decisions, UI locations, visual references,
interaction patterns, reuse requirements, and constraints. Preserve material
details rather than replacing them with a generalized outcome.>

## Technical context
<Confirmed repository evidence and links. Explicitly identify hypotheses.>

## Proposed scope
- <Evidence-backed outcome or acceptance criterion>
- <Another outcome, without prescribing an unsupported implementation>
```

Use Ragworks' plain, factual voice. Avoid marketing language, decorative explanation, and implementation certainty the evidence does not support.

Before presenting the draft, perform a fidelity pass against the user's messages:

1. Identify the reported incident and causal sequence.
2. Identify why the user believes it matters, including product or design philosophy.
3. Identify every concrete example, explicit decision, constraint, and later correction.
4. Preserve uncertainty and open questions at the same level; do not add implementation specificity or causal certainty the user did not provide.
5. Confirm that each item remains recognizable in the draft, not merely implied by a generalized requirement.

If the draft contains the same general requirements but no longer explains what the user experienced or why they reached those conclusions, rewrite it before presenting. If two directions conflict, surface the conflict instead of choosing one silently.

## Approval and creation

Always show the title, complete body, repository links, and proposed labels before creating an issue. End by recommending that draft and asking for approval to post it.

- Treat an affirmative reply such as “yes,” “looks good,” “go ahead,” or “post it” as authorization to create the issue exactly as approved.
- Treat corrections, questions, or added context as instructions to revise and present the draft again.
- Treat silence as no authorization. Never create an issue merely because time passed.
- If approval is ambiguous, ask one short confirmation rather than mutating GitHub.

After creation, return the issue URL and the labels applied. If creation or labeling partially fails, report the exact state and do not silently retry with altered content.

## Common mistakes

| Mistake | Correct behavior |
|---|---|
| Replacing the complaint with architecture language | Keep a distinct `User experience` section |
| Replacing a first-person incident with generic policy prose | Preserve the causal story and the user's reasoning |
| Polishing dictated feedback until its authorship disappears | Edit wording and structure while retaining voice, emphasis, and philosophy |
| Preserving the outcome but dropping why it matters | Retain the user's reasoning and design philosophy explicitly |
| Adding details that sound reasonable but were never decided | Preserve the source's uncertainty and leave those details open |
| Converting explicit design decisions into generic outcomes | Preserve them in `Product and design direction` |
| Silently substituting a preferred implementation | Explain the conflict and ask before changing direction |
| Naming an unverified root cause | Separate facts from hypotheses |
| Expanding immediately into a rewrite | Define outcomes supported by evidence |
| Copying remembered labels | Check live repository labels |
| Posting while still clarifying | Revise the draft and obtain approval |
| Asking a long questionnaire | Ask one consequential question at a time |
