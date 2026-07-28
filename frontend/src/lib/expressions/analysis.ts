/**
 * Static analysis: type checking and variable references — the TypeScript
 * mirror of `app/pipelines/expressions/analysis.py`. Powers live editor
 * feedback (type errors before saving) and variable-usage checks.
 */

import { typeError } from "./errors";
import { BUILTINS, arityMessage } from "./functions";
import { MEMBERS_BY_TYPE, SELF_SCOPE, isNumericType, type ExprType } from "./values";

import type { Expression } from "./parser";

export type TypeEnvironment = ReadonlyMap<string, ExprType>;

/** The config fields of the node an expression sits on, read via `self.`. */
export type SelfTypes = ReadonlyMap<string, ExprType>;

export function checkType(expr: Expression, env: TypeEnvironment, selfTypes?: SelfTypes): ExprType {
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
      if (expr.name === SELF_SCOPE) {
        throw typeError(
          `'${SELF_SCOPE}' is a scope, not a value — read a field with '${SELF_SCOPE}.<field>'`,
          expr.position,
        );
      }
      const type = env.get(expr.name);
      if (type === undefined) {
        throw typeError(`Unknown variable '${expr.name}'`, expr.position);
      }
      return type;
    }
    case "member":
      return checkMember(expr, env, selfTypes);
    case "unary": {
      const operand = checkType(expr.operand, env, selfTypes);
      if (!isNumericType(operand)) {
        throw typeError(`Unary '-' requires a number, got ${operand}`, expr.position);
      }
      return operand;
    }
    case "binary":
      return checkBinary(expr, env, selfTypes);
    case "call":
      return checkCall(expr, env, selfTypes);
  }
}

function checkMember(
  expr: Extract<Expression, { kind: "member" }>,
  env: TypeEnvironment,
  selfTypes?: SelfTypes,
): ExprType {
  if (expr.base.kind === "name" && expr.base.name === SELF_SCOPE) {
    return checkSelfMember(expr, selfTypes);
  }
  const base = checkType(expr.base, env, selfTypes);
  const members = MEMBERS_BY_TYPE[base];
  if (members === undefined) {
    const structured = Object.keys(MEMBERS_BY_TYPE).sort().join(" or ");
    throw typeError(`Member access requires a ${structured} variable, got ${base}`, expr.position);
  }
  const member = members[expr.attribute];
  if (member === undefined) {
    const allowed = Object.keys(members).sort().join(", ");
    throw typeError(
      `Unknown ${base} member '${expr.attribute}' (expected one of: ${allowed})`,
      expr.position,
    );
  }
  return member;
}

function checkSelfMember(
  expr: Extract<Expression, { kind: "member" }>,
  selfTypes?: SelfTypes,
): ExprType {
  if (selfTypes === undefined) {
    throw typeError(`'${SELF_SCOPE}' is only available on a node's config field`, expr.position);
  }
  const fieldType = selfTypes.get(expr.attribute);
  if (fieldType === undefined) {
    const allowed = [...selfTypes.keys()].sort().join(", ") || "none";
    throw typeError(
      `This node has no config field '${expr.attribute}' (expected one of: ${allowed})`,
      expr.position,
    );
  }
  return fieldType;
}

function checkBinary(
  expr: Extract<Expression, { kind: "binary" }>,
  env: TypeEnvironment,
  selfTypes?: SelfTypes,
): ExprType {
  const left = checkType(expr.left, env, selfTypes);
  const right = checkType(expr.right, env, selfTypes);
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

function checkCall(
  expr: Extract<Expression, { kind: "call" }>,
  env: TypeEnvironment,
  selfTypes?: SelfTypes,
): ExprType {
  const spec = BUILTINS[expr.name];
  if (!spec) {
    throw typeError(`Unknown function '${expr.name}'`, expr.position);
  }
  const received = expr.args.length;
  if (received < spec.minArgs || (spec.maxArgs !== null && received > spec.maxArgs)) {
    throw typeError(arityMessage(spec, received), expr.position);
  }
  const argTypes = expr.args.map((arg) => checkType(arg, env, selfTypes));
  expr.args.forEach((arg, index) => {
    if (!isNumericType(argTypes[index])) {
      throw typeError(`${spec.name}() requires numbers, got ${argTypes[index]}`, arg.position);
    }
  });
  if (spec.result === "always_int") {
    return "integer";
  }
  if (spec.result === "always_number") {
    return "number";
  }
  return argTypes.every((argType) => argType === "integer") ? "integer" : "number";
}

/**
 * Every *pipeline variable* the expression reads.
 *
 * `self.<field>` is excluded: it reads a sibling config field, not a variable.
 */
export function references(expr: Expression): Set<string> {
  switch (expr.kind) {
    case "name":
      return expr.name === SELF_SCOPE ? new Set() : new Set([expr.name]);
    case "member":
      if (expr.base.kind === "name" && expr.base.name === SELF_SCOPE) {
        return new Set();
      }
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

/** Every sibling config field the expression reads via `self.`. */
export function selfReferences(expr: Expression): Set<string> {
  switch (expr.kind) {
    case "member":
      if (expr.base.kind === "name" && expr.base.name === SELF_SCOPE) {
        return new Set([expr.attribute]);
      }
      return selfReferences(expr.base);
    case "unary":
      return selfReferences(expr.operand);
    case "binary":
      return new Set([...selfReferences(expr.left), ...selfReferences(expr.right)]);
    case "call":
      return new Set(expr.args.flatMap((arg) => [...selfReferences(arg)]));
    default:
      return new Set();
  }
}
