/**
 * Suggestion logic for the expression combobox: which names to offer, how to
 * filter them against the identifier token at the caret, and how an accepted
 * suggestion rewrites the source. Pure (no React) so the ranking and
 * token-replacement rules are unit-testable.
 */

import { BUILTINS } from "@/lib/expressions/functions";

import { formatPreviewValue } from "./variable-env";

import type { StaticEnvironment } from "./variable-env";
import type { ExprType } from "@/lib/expressions";

export type SuggestionKind = "variable" | "function";

export interface Suggestion {
  name: string;
  kind: SuggestionKind;
  /** Badge text: the variable's source, or "fn". */
  badge: string;
  /** Type or signature, for the row's detail column. */
  detail: string;
  /** Current static value, for variables. */
  preview: string | null;
  /** Text inserted in place of the caret token. */
  insertText: string;
  /** Caret position within insertText after acceptance. */
  caretOffset: number;
}

const FUNCTION_SIGNATURES: Record<string, string> = {
  min: "min(a, b, …)",
  max: "max(a, b, …)",
  clamp: "clamp(value, low, high)",
  floor: "floor(x)",
  ceil: "ceil(x)",
  round: "round(x)",
};

/** Every suggestion the environment offers, variables first.
 *
 * `staticOnly` fields exclude tainted names (they would be rejected by the
 * identity-field rule). When `expectedType` is set, matching-type variables
 * rank before the rest; functions always follow variables.
 */
export function buildSuggestions(
  env: StaticEnvironment,
  options: { expectedType?: ExprType | null; staticOnly?: boolean } = {},
): Suggestion[] {
  const variables: Suggestion[] = [];
  for (const [name, type] of env.types) {
    if (env.problems.has(name)) continue;
    if (options.staticOnly && env.tainted.has(name)) continue;
    variables.push({
      name,
      kind: "variable",
      badge: env.sources.get(name) === "input" ? "input" : (env.sources.get(name) ?? "value"),
      detail: type,
      preview: formatPreviewValue(env.values.get(name)),
      insertText: name,
      caretOffset: name.length,
    });
  }
  const expected = options.expectedType;
  if (expected) {
    const matches = (suggestion: Suggestion) =>
      suggestion.detail === expected || (suggestion.detail === "integer" && expected === "number");
    variables.sort((a, b) => Number(matches(b)) - Number(matches(a)));
  }
  const functions: Suggestion[] = Object.keys(BUILTINS).map((name) => ({
    name,
    kind: "function",
    badge: "fn",
    detail: FUNCTION_SIGNATURES[name] ?? `${name}(…)`,
    preview: null,
    insertText: `${name}()`,
    caretOffset: name.length + 1,
  }));
  return [...variables, ...functions];
}

export interface CaretToken {
  start: number;
  end: number;
  text: string;
}

const IDENTIFIER_CHAR = /[a-z0-9_]/i;
const IDENTIFIER_START = /[a-z_]/i;

/** The identifier token the caret sits in or immediately after, else an
 * empty token at the caret (suggestions then insert rather than replace). */
export function caretToken(source: string, caret: number): CaretToken {
  let start = caret;
  while (start > 0 && IDENTIFIER_CHAR.test(source[start - 1])) start -= 1;
  let end = caret;
  while (end < source.length && IDENTIFIER_CHAR.test(source[end])) end += 1;
  const text = source.slice(start, end);
  if (text && !IDENTIFIER_START.test(text[0])) {
    return { start: caret, end: caret, text: "" };
  }
  return { start, end, text };
}

/** Filter suggestions against the token: prefix matches first, then
 * substring matches; an empty token keeps everything. */
export function filterSuggestions(suggestions: Suggestion[], token: string): Suggestion[] {
  if (!token) return suggestions;
  const needle = token.toLowerCase();
  const prefixed = suggestions.filter((s) => s.name.toLowerCase().startsWith(needle));
  const contained = suggestions.filter(
    (s) => !s.name.toLowerCase().startsWith(needle) && s.name.toLowerCase().includes(needle),
  );
  return [...prefixed, ...contained];
}

/** Replace the caret token with the suggestion; returns the new source and caret. */
export function applySuggestion(
  source: string,
  token: CaretToken,
  suggestion: Suggestion,
): { source: string; caret: number } {
  const next = source.slice(0, token.start) + suggestion.insertText + source.slice(token.end);
  return { source: next, caret: token.start + suggestion.caretOffset };
}
