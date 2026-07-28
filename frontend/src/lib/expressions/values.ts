/**
 * Value and type domain for pipeline expressions — the TypeScript mirror of
 * `app/pipelines/expressions/values.py`. JavaScript has one number type, so
 * a runtime number counts as `integer` when `Number.isInteger` holds; the
 * static checker is the authority on integer-vs-number typing.
 */

export type ExprType = "integer" | "number" | "string" | "boolean" | "model" | "index";

export interface ModelValue {
  connection_id: string;
  model_name: string;
}

export interface IndexValue {
  index_id: string;
  backend: string;
  name: string;
}

export type ExprValue = number | string | boolean | ModelValue | IndexValue;

/**
 * Qualifier for a node's *own* config fields: `self.chunk_size`.
 *
 * A scope, not a value — its members are the config fields of whichever node
 * the expression sits on, so they vary per node rather than coming from a
 * fixed member map. Mirrors `SELF_SCOPE` in
 * `app/pipelines/expressions/values.py`.
 */
export const SELF_SCOPE = "self";

export const MODEL_MEMBERS: Record<string, ExprType> = {
  connection_id: "string",
  model_name: "string",
};

export const INDEX_MEMBERS: Record<string, ExprType> = {
  id: "string",
  backend: "string",
  name: "string",
};

/** The full member-access surface, keyed by the structured type that owns it. */
export const MEMBERS_BY_TYPE: Partial<Record<ExprType, Record<string, ExprType>>> = {
  model: MODEL_MEMBERS,
  index: INDEX_MEMBERS,
};

export function isNumericType(type: ExprType): boolean {
  return type === "integer" || type === "number";
}

export function isIndexValue(value: ExprValue): value is IndexValue {
  return typeof value === "object" && value !== null && "index_id" in value;
}

export function isModelValue(value: ExprValue): value is ModelValue {
  return typeof value === "object" && value !== null && !isIndexValue(value);
}

export function valueType(value: ExprValue): ExprType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return isIndexValue(value) ? "index" : "model";
}

/**
 * Whether a result of `result` can be stored in a field expecting `expected`.
 * Integers satisfy number fields; everything else must match exactly. Mirrors
 * `is_assignable` in `app/pipelines/expressions/values.py`.
 */
export function isAssignableType(result: ExprType, expected: ExprType): boolean {
  return result === expected || (result === "integer" && expected === "number");
}
