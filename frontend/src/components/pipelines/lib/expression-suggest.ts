/**
 * Suggestion logic for the expression combobox: which names to offer, how to
 * filter them against the identifier token at the caret, and how an accepted
 * suggestion rewrites the source. Pure (no React) so the ranking and
 * token-replacement rules are unit-testable.
 */

import { MEMBERS_BY_TYPE, isAssignableType } from "@/lib/expressions";
import { BUILTINS } from "@/lib/expressions/functions";

import { formatPreviewValue } from "./variable-env";

import type { StaticEnvironment } from "./variable-env";
import type { ExprType, ExprValue } from "@/lib/expressions";

export type SuggestionKind = "variable" | "function" | "field";

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
  percent: "percent(value, percent)",
};

/** Every suggestion the environment offers, variables first.
 *
 * `staticOnly` fields exclude tainted names (they would be rejected by the
 * identity-field rule). When `expectedType` is set, matching-type variables
 * rank before the rest; functions always follow variables.
 */
/**
 * Whether a name of `type` is worth offering for a field expecting `expected`.
 *
 * Wider than assignability by exactly one case: an integer field also takes a
 * number, because resolution rounds it. Offering less than the field accepts
 * hides usable names; offering more hands the author a guaranteed error.
 */
function offerable(type: ExprType, expected: ExprType): boolean {
  if (isAssignableType(type, expected) || (expected === "integer" && type === "number")) {
    return true;
  }
  // A structured value is never stored directly, but it is the route to a
  // member that can be — `item.has_image` in a boolean field. Withholding the
  // name leaves the dropdown empty on exactly the field the scope exists for.
  const members = MEMBERS_BY_TYPE[type];
  return members
    ? Object.values(members).some((member) => isAssignableType(member, expected))
    : false;
}

export function buildSuggestions(
  env: StaticEnvironment,
  options: {
    expectedType?: ExprType | null;
    staticOnly?: boolean;
    /** The editing node's other config fields, offered as `self.<field>`. */
    selfFields?: ReadonlyMap<string, ExprType>;
    /** The field being edited — never suggested, since it cannot read itself. */
    selfFieldKey?: string;
    /** Current sibling values; a field with none is not offered. */
    selfValues?: ReadonlyMap<string, unknown>;
  } = {},
): Suggestion[] {
  const variables: Suggestion[] = [];
  for (const [name, type] of env.types) {
    if (env.problems.has(name)) continue;
    if (options.staticOnly && env.tainted.has(name)) continue;
    // Same rule as siblings: a variable this field cannot hold is a trap.
    if (options.expectedType && !offerable(type, options.expectedType)) continue;
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
  const fields: Suggestion[] = [];
  const expectedType = options.expectedType;
  for (const [name, type] of options.selfFields ?? new Map()) {
    // A field reading itself is the shortest possible cycle.
    if (name === options.selfFieldKey) continue;
    // Only offer what this field can actually hold. A string sibling in an
    // integer box is a guaranteed type error, so offering it is a trap.
    if (expectedType && !offerable(type, expectedType)) continue;
    // A sibling with no value cannot be read: the expression would type-check
    // and then fail to resolve, which is worse than never offering it.
    if (options.selfValues && !options.selfValues.has(name)) continue;
    fields.push({
      name: `self.${name}`,
      kind: "field",
      badge: "field",
      detail: type,
      // Every row states what it resolves to, so a name can be chosen on its
      // value rather than on guessing what the node currently holds.
      preview: formatPreviewValue(options.selfValues?.get(name) as ExprValue | undefined),
      insertText: `self.${name}`,
      caretOffset: `self.${name}`.length,
    });
  }
  if (expectedType) {
    const matches = (suggestion: Suggestion) =>
      offerable(suggestion.detail as ExprType, expectedType);
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
  // Fields first: a value derived from the same node is the common case the
  // scope exists for, and it is what the author is looking at.
  return [...fields, ...variables, ...functions];
}

export interface CaretToken {
  start: number;
  end: number;
  text: string;
}

const IDENTIFIER_CHAR = /[a-z0-9_]/i;
const IDENTIFIER_START = /[a-z_]/i;

const SELF_QUALIFIER = "self.";

/** The identifier token the caret sits in or immediately after, else an
 * empty token at the caret (suggestions then insert rather than replace).
 *
 * A leading `self.` is absorbed into the token, because a `self.<field>`
 * suggestion inserts the whole qualified name: leaving the qualifier outside
 * the replaced range turns `self.ch` into `self.self.chunk_size`. */
export function caretToken(source: string, caret: number): CaretToken {
  let start = caret;
  while (start > 0 && IDENTIFIER_CHAR.test(source[start - 1])) start -= 1;
  let end = caret;
  while (end < source.length && IDENTIFIER_CHAR.test(source[end])) end += 1;
  if (source.slice(Math.max(0, start - SELF_QUALIFIER.length), start) === SELF_QUALIFIER) {
    start -= SELF_QUALIFIER.length;
  }
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
