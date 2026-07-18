/**
 * Static analysis: type checking and variable references — the TypeScript
 * mirror of `app/pipelines/expressions/analysis.py`. Powers live editor
 * feedback (type errors before saving) and variable-usage checks.
 */

import { typeError } from "./errors";
import { BUILTINS, arityMessage } from "./functions";
import { MODEL_MEMBERS, isNumericType, type ExprType } from "./values";

import type { Expression } from "./parser";

export type TypeEnvironment = ReadonlyMap<string, ExprType>;

export function checkType(expr: Expression, env: TypeEnvironment): ExprType {
  switch (expr.kind) {
    case "int":
      return "integer";
    case "float":
      return "number";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "name": {
      const type = env.get(expr.name);
      if (type === undefined) {
        throw typeError(`Unknown variable '${expr.name}'`, expr.position);
      }
      return type;
    }
    case "member":
      return checkMember(expr, env);
    case "unary": {
      const operand = checkType(expr.operand, env);
      if (!isNumericType(operand)) {
        throw typeError(`Unary '-' requires a number, got ${operand}`, expr.position);
      }
      return operand;
    }
    case "binary":
      return checkBinary(expr, env);
    case "call":
      return checkCall(expr, env);
  }
}

function checkMember(
  expr: Extract<Expression, { kind: "member" }>,
  env: TypeEnvironment,
): ExprType {
  const base = checkType(expr.base, env);
  if (base !== "model") {
    throw typeError(`Member access requires a model variable, got ${base}`, expr.position);
  }
  const member = MODEL_MEMBERS[expr.attribute];
  if (member === undefined) {
    const allowed = Object.keys(MODEL_MEMBERS).sort().join(", ");
    throw typeError(
      `Unknown model member '${expr.attribute}' (expected one of: ${allowed})`,
      expr.position,
    );
  }
  return member;
}

function checkBinary(
  expr: Extract<Expression, { kind: "binary" }>,
  env: TypeEnvironment,
): ExprType {
  const left = checkType(expr.left, env);
  const right = checkType(expr.right, env);
  if (expr.op === "+" && left === "string" && right === "string") {
    return "string";
  }
  if (expr.op === "//" || expr.op === "%") {
    if (left === "integer" && right === "integer") {
      return "integer";
    }
    throw typeError(`'${expr.op}' requires integers, got ${left} and ${right}`, expr.position);
  }
  if (!isNumericType(left) || !isNumericType(right)) {
    throw typeError(`'${expr.op}' cannot combine ${left} and ${right}`, expr.position);
  }
  if (expr.op === "/") {
    return "number";
  }
  return left === "integer" && right === "integer" ? "integer" : "number";
}

function checkCall(expr: Extract<Expression, { kind: "call" }>, env: TypeEnvironment): ExprType {
  const spec = BUILTINS[expr.name];
  if (!spec) {
    throw typeError(`Unknown function '${expr.name}'`, expr.position);
  }
  const received = expr.args.length;
  if (received < spec.minArgs || (spec.maxArgs !== null && received > spec.maxArgs)) {
    throw typeError(arityMessage(spec, received), expr.position);
  }
  const argTypes = expr.args.map((arg) => checkType(arg, env));
  expr.args.forEach((arg, index) => {
    if (!isNumericType(argTypes[index])) {
      throw typeError(`${spec.name}() requires numbers, got ${argTypes[index]}`, arg.position);
    }
  });
  if (spec.result === "always_int") {
    return "integer";
  }
  return argTypes.every((argType) => argType === "integer") ? "integer" : "number";
}

/** Every variable name the expression reads. */
export function references(expr: Expression): Set<string> {
  switch (expr.kind) {
    case "name":
      return new Set([expr.name]);
    case "member":
      return references(expr.base);
    case "unary":
      return references(expr.operand);
    case "binary":
      return new Set([...references(expr.left), ...references(expr.right)]);
    case "call":
      return new Set(expr.args.flatMap((arg) => [...references(arg)]));
    default:
      return new Set();
  }
}
