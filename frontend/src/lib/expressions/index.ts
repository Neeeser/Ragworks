/**
 * Typed expression language for pipeline variables — the TypeScript mirror of
 * `app/pipelines/expressions/` (the backend is the source of truth). Both
 * implementations run the shared conformance vectors in
 * `tests/assets/expression_vectors.json`, so grammar or semantics changes
 * must land on both sides plus the vectors.
 *
 * Also owns the config wire tag: a node config value is either a literal or
 * `{"$expr": "top_k * 2"}` — `expressionSource` is the one detector.
 */

export { ExpressionError, type ExpressionErrorKind } from "./errors";
export { checkType, references, type TypeEnvironment } from "./analysis";
export { evaluate, type ValueEnvironment } from "./evaluator";
export { parse, type Expression } from "./parser";
export {
  MODEL_MEMBERS,
  isModelValue,
  isNumericType,
  valueType,
  type ExprType,
  type ExprValue,
  type ModelValue,
} from "./values";

export const EXPRESSION_KEY = "$expr";

/** Wire shape of an expression-valued config field. */
export interface ExpressionValue {
  [EXPRESSION_KEY]: string;
}

/** Return the expression source when `value` is a `{"$expr": ...}` wire tag. */
export function expressionSource(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    EXPRESSION_KEY in value
  ) {
    const source = (value as Record<string, unknown>)[EXPRESSION_KEY];
    if (typeof source === "string") {
      return source;
    }
  }
  return null;
}

/** Build the `{"$expr": ...}` wire value for an expression source. */
export function expressionValue(source: string): ExpressionValue {
  return { [EXPRESSION_KEY]: source };
}
