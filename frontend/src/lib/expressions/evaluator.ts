/**
 * Evaluator — the TypeScript mirror of `app/pipelines/expressions/evaluator.py`.
 * Floor division and modulo follow floor semantics (Python's), pinned by the
 * shared vectors: `-7 // 2 === -4`, `-7 % 3 === 2`.
 */

import { evalError, typeError } from "./errors";
import { BUILTINS, arityMessage } from "./functions";
import { AND_KEYWORD, COMPARISON_OPERATORS, LOGICAL_OPERATORS, ORDERING_OPERATORS } from "./parser";
import {
  INDEX_MEMBERS,
  ITEM_MEMBERS,
  MODEL_MEMBERS,
  SELF_SCOPE,
  isIndexValue,
  isItemValue,
  isMetadataValue,
  isModelValue,
  itemMember,
  metadataRead,
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
    case "not":
      return !requireBoolean(evaluate(expr.operand, env, selfValues), "not", expr.position);
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

function requireBoolean(value: ExprValue, op: string, position: number): boolean {
  if (typeof value !== "boolean") {
    throw typeError(`'${op}' requires a boolean, got ${valueType(value)}`, position);
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
  const member = readStructuredMember(base, expr.attribute);
  if (member === undefined) {
    throw typeError(`Cannot access '${expr.attribute}' on ${valueType(base)}`, expr.position);
  }
  return member;
}

/** Read one member off a structured value, or `undefined` when it has none. */
function readStructuredMember(base: ExprValue, attribute: string): ExprValue | undefined {
  if (typeof base !== "object" || base === null) return undefined;
  if (isMetadataValue(base)) {
    // Open keys: an absent one reads empty, so a predicate over a key only
    // some of the corpus carries is false rather than fatal.
    return metadataRead(base, attribute);
  }
  if (isItemValue(base) && attribute in ITEM_MEMBERS) {
    return itemMember(base, attribute);
  }
  if (isIndexValue(base) && attribute in INDEX_MEMBERS) {
    if (attribute === "id") return base.index_id;
    return attribute === "backend" ? base.backend : base.name;
  }
  if (isModelValue(base) && attribute in MODEL_MEMBERS) {
    return attribute === "connection_id" ? base.connection_id : base.model_name;
  }
  return undefined;
}

function evaluateBinary(
  expr: Extract<Expression, { kind: "binary" }>,
  env: ValueEnvironment,
  selfValues?: SelfValues,
): ExprValue {
  if (LOGICAL_OPERATORS.includes(expr.op)) {
    return evaluateLogical(expr, env, selfValues);
  }
  const left = evaluate(expr.left, env, selfValues);
  const right = evaluate(expr.right, env, selfValues);
  if (COMPARISON_OPERATORS.includes(expr.op)) {
    return evaluateComparison(expr, left, right);
  }
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

/**
 * Evaluate `and`/`or`, short-circuiting on the left operand.
 *
 * The right operand of `item.has_text and item.text_length > 5` is only
 * meaningful where the left one held, so it is not evaluated otherwise — and
 * an error hiding in it is not reported for items the guard already excluded.
 */
function evaluateLogical(
  expr: Extract<Expression, { kind: "binary" }>,
  env: ValueEnvironment,
  selfValues?: SelfValues,
): boolean {
  const left = requireBoolean(evaluate(expr.left, env, selfValues), expr.op, expr.position);
  if ((expr.op === AND_KEYWORD) !== left) {
    return left;
  }
  return requireBoolean(evaluate(expr.right, env, selfValues), expr.op, expr.position);
}

function ordered<T extends number | string>(op: string, left: T, right: T): boolean {
  if (op === "<") return left < right;
  if (op === "<=") return left <= right;
  if (op === ">") return left > right;
  return left >= right;
}

/**
 * Compare two values, re-deriving the pairing the type checker allowed.
 * Booleans compare only for equality, never as numbers.
 */
function evaluateComparison(
  expr: Extract<Expression, { kind: "binary" }>,
  left: ExprValue,
  right: ExprValue,
): boolean {
  const bothNumbers = typeof left === "number" && typeof right === "number";
  const bothStrings = typeof left === "string" && typeof right === "string";
  if (ORDERING_OPERATORS.includes(expr.op)) {
    if (typeof left === "string" && typeof right === "string") {
      return ordered(expr.op, left, right);
    }
    if (typeof left === "number" && typeof right === "number") {
      return ordered(expr.op, left, right);
    }
  } else if (
    bothNumbers ||
    bothStrings ||
    (typeof left === "boolean" && typeof right === "boolean")
  ) {
    return expr.op === "==" ? left === right : left !== right;
  }
  throw typeError(
    `'${expr.op}' cannot compare ${valueType(left)} and ${valueType(right)}`,
    expr.position,
  );
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
