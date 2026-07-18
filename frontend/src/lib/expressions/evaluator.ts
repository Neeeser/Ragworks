/**
 * Evaluator — the TypeScript mirror of `app/pipelines/expressions/evaluator.py`.
 * Floor division and modulo follow floor semantics (Python's), pinned by the
 * shared vectors: `-7 // 2 === -4`, `-7 % 3 === 2`.
 */

import { evalError, typeError } from "./errors";
import { BUILTINS, arityMessage } from "./functions";
import { MODEL_MEMBERS, isModelValue, valueType, type ExprValue } from "./values";

import type { Expression } from "./parser";

export type ValueEnvironment = ReadonlyMap<string, ExprValue>;

export function evaluate(expr: Expression, env: ValueEnvironment): ExprValue {
  switch (expr.kind) {
    case "int":
    case "float":
    case "string":
    case "boolean":
      return expr.value;
    case "name": {
      const value = env.get(expr.name);
      if (value === undefined) {
        throw typeError(`Unknown variable '${expr.name}'`, expr.position);
      }
      return value;
    }
    case "member":
      return evaluateMember(expr, env);
    case "unary":
      return -requireNumeric(evaluate(expr.operand, env), "Unary '-'", expr.position);
    case "binary":
      return evaluateBinary(expr, env);
    case "call":
      return evaluateCall(expr, env);
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
): ExprValue {
  const base = evaluate(expr.base, env);
  if (!isModelValue(base) || !(expr.attribute in MODEL_MEMBERS)) {
    throw typeError(`Cannot access '${expr.attribute}' on ${valueType(base)}`, expr.position);
  }
  return expr.attribute === "connection_id" ? base.connection_id : base.model_name;
}

function evaluateBinary(
  expr: Extract<Expression, { kind: "binary" }>,
  env: ValueEnvironment,
): ExprValue {
  const left = evaluate(expr.left, env);
  const right = evaluate(expr.right, env);
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
    requireNumeric(evaluate(arg, env), `${spec.name}()`, arg.position),
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
