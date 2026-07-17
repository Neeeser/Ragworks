/**
 * Value and type domain for pipeline expressions — the TypeScript mirror of
 * `app/pipelines/expressions/values.py`. JavaScript has one number type, so
 * a runtime number counts as `integer` when `Number.isInteger` holds; the
 * static checker is the authority on integer-vs-number typing.
 */

export type ExprType = "integer" | "number" | "string" | "boolean" | "model";

export interface ModelValue {
  connection_id: string;
  model_name: string;
}

export type ExprValue = number | string | boolean | ModelValue;

export const MODEL_MEMBERS: Record<string, ExprType> = {
  connection_id: "string",
  model_name: "string",
};

export function isNumericType(type: ExprType): boolean {
  return type === "integer" || type === "number";
}

export function isModelValue(value: ExprValue): value is ModelValue {
  return typeof value === "object" && value !== null;
}

export function valueType(value: ExprValue): ExprType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return "model";
}
