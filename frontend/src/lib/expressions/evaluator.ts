/**
 * Evaluator — the TypeScript mirror of `app/pipelines/expressions/evaluator.py`.
 * Floor division and modulo follow floor semantics (Python's), pinned by the
 * shared vectors: `-7 // 2 === -4`, `-7 % 3 === 2`.
 */

import { evalError, typeError } from "./errors";
import { BUILTINS, arityMessage } from "./functions";
import {
  INDEX_MEMBERS,
  MODEL_MEMBERS,
  SELF_SCOPE,
  isIndexValue,
  isModelValue,
  valueType,
  type ExprValue,
} from "./values";

import type { Expression } from "./parser";

export type ValueEnvironment = ReadonlyMap<string, ExprValue>;

/** Already-resolved sibling config fields of the node the expression sits on. */
export type SelfValues = ReadonlyMap<string, ExprValue>;

export function evaluate(
  expr: Expression,
  env: ValueEnvironment,
  selfValues?: SelfValues,
): ExprValue {
  switch (expr.kind) {
    case "int":
    case "float":
    case "string":
    case "boolean":
      return expr.value;
    case "name": {
      if (expr.name === SELF_SCOPE) {
        throw typeError(`'${SELF_SCOPE}' is a scope, not a value`, expr.position);
      }
      const value = env.get(expr.name);
      if (value === undefined) {
        throw typeError(`Unknown variable '${expr.name}'`, expr.position);
      }
      return value;
    }
    case "member":
      return evaluateMember(expr, env, selfValues);
    case "unary":
      return -requireNumeric(evaluate(expr.operand, env, selfValues), "Unary '-'", expr.position);
    case "binary":
      return evaluateBinary(expr, env, selfValues);
    case "call":
      return evaluateCall(expr, env, selfValues);
  }
}

function requireNumeric(value: ExprValue, context: string, position: number): number {
  if (typeof value !== "number") {
    throw typeError(`${context} requires a number, got ${valueType(value)}`, position);
  }
  return value;
}

function requireInteger(value: ExprValue, op: string, position: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw typeError(`'${op}' requires integers, got ${valueType(value)}`, position);
  }
  return value;
}

function evaluateMember(
  expr: Extract<Expression, { kind: "member" }>,
  env: ValueEnvironment,
  selfValues?: SelfValues,
): ExprValue {
  if (expr.base.kind === "name" && expr.base.name === SELF_SCOPE) {
    const value = selfValues?.get(expr.attribute);
    if (value === undefined) {
      throw typeError(`This node has no config field '${expr.attribute}'`, expr.position);
    }
    return value;
  }
  const base = evaluate(expr.base, env, selfValues);
  if (typeof base === "object" && base !== null) {
    if (isIndexValue(base) && expr.attribute in INDEX_MEMBERS) {
      if (expr.attribute === "id") return base.index_id;
      return expr.attribute === "backend" ? base.backend : base.name;
    }
    if (isModelValue(base) && expr.attribute in MODEL_MEMBERS) {
      return expr.attribute === "connection_id" ? base.connection_id : base.model_name;
    }
  }
  throw typeError(`Cannot access '${expr.attribute}' on ${valueType(base)}`, expr.position);
}

function evaluateBinary(
  expr: Extract<Expression, { kind: "binary" }>,
  env: ValueEnvironment,
  selfValues?: SelfValues,
): ExprValue {
  const left = evaluate(expr.left, env, selfValues);
  const right = evaluate(expr.right, env, selfValues);
  if (expr.op === "+" && typeof left === "string" && typeof right === "string") {
    return left + right;
  }
  if (expr.op === "//" || expr.op === "%") {
    const leftInt = requireInteger(left, expr.op, expr.position);
    const rightInt = requireInteger(right, expr.op, expr.position);
    if (rightInt === 0) {
      throw evalError(`'${expr.op}' by zero`, expr.position);
    }
    const quotient = Math.floor(leftInt / rightInt);
    return expr.op === "//" ? quotient : leftInt - quotient * rightInt;
  }
  const leftNum = requireNumeric(left, `'${expr.op}'`, expr.position);
  const rightNum = requireNumeric(right, `'${expr.op}'`, expr.position);
  switch (expr.op) {
    case "+":
      return leftNum + rightNum;
    case "-":
      return leftNum - rightNum;
    case "*":
      return leftNum * rightNum;
    default:
      if (rightNum === 0) {
        throw evalError("'/' by zero", expr.position);
      }
      return leftNum / rightNum;
  }
}

function evaluateCall(
  expr: Extract<Expression, { kind: "call" }>,
  env: ValueEnvironment,
  selfValues?: SelfValues,
): ExprValue {
  const spec = BUILTINS[expr.name];
  if (!spec) {
    throw typeError(`Unknown function '${expr.name}'`, expr.position);
  }
  const received = expr.args.length;
  if (received < spec.minArgs || (spec.maxArgs !== null && received > spec.maxArgs)) {
    throw typeError(arityMessage(spec, received), expr.position);
  }
  const args = expr.args.map((arg) =>
    requireNumeric(evaluate(arg, env, selfValues), `${spec.name}()`, arg.position),
  );
  try {
    return spec.apply(args);
  } catch (error) {
    if (error instanceof Error && "kind" in error) {
      throw evalError(error.message, expr.position);
    }
    throw error;
  }
}
