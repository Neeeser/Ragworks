/**
 * Static variable environments for the editor, mirroring the backend's
 * `default_environment` semantics (`app/pipelines/resolution.py`): the
 * built-in `query`, every declared input argument (default or a
 * constraint-respecting placeholder), and every panel variable (constants
 * validated, derived expressions evaluated in dependency order). Powers live
 * expression type checks and value previews before anything is saved.
 */

import { checkType, evaluate, parse, references, ExpressionError } from "@/lib/expressions";

import type { ExprType, ExprValue } from "@/lib/expressions";
import type { PipelineInputArgument, PipelineVariable, VariableType } from "@/lib/types";

export const QUERY_VARIABLE = "query";
export const RETRIEVAL_INPUT_TYPE = "retrieval.input";
export const RETRIEVAL_OUTPUT_TYPE = "retrieval.output";

export const VARIABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;
export const RESERVED_VARIABLE_NAMES = new Set([
  QUERY_VARIABLE,
  "true",
  "false",
  "min",
  "max",
  "clamp",
  "floor",
  "ceil",
  "round",
]);

export const VARIABLE_TYPE_OPTIONS: Array<{ value: VariableType; label: string }> = [
  { value: "integer", label: "Integer" },
  { value: "number", label: "Number" },
  { value: "string", label: "String" },
  { value: "boolean", label: "Boolean" },
  { value: "enum", label: "Enum" },
  { value: "model", label: "Model" },
];

export function exprTypeOf(type: VariableType): ExprType {
  if (type === "enum") return "string";
  return type;
}

type NodeLike = { type: string; config: Record<string, unknown> };

/** Read the declared input arguments off retrieval.input node configs. */
export function declaredArguments(nodes: NodeLike[]): PipelineInputArgument[] {
  const collected: PipelineInputArgument[] = [];
  for (const node of nodes) {
    if (node.type !== RETRIEVAL_INPUT_TYPE) continue;
    const raw = node.config.arguments;
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { name?: unknown }).name === "string"
      ) {
        collected.push(entry as unknown as PipelineInputArgument);
      }
    }
  }
  return collected;
}

export interface StaticEnvironment {
  types: Map<string, ExprType>;
  values: Map<string, ExprValue>;
  /** Names that derive (transitively) from caller input — the taint set. */
  tainted: Set<string>;
  /** Per-variable problems found while building the environment. */
  problems: Map<string, string>;
}

function argumentPlaceholder(argument: PipelineInputArgument): ExprValue {
  if (argument.default !== null && argument.default !== undefined) return argument.default;
  if (argument.type === "integer")
    return argument.minimum != null ? Math.trunc(argument.minimum) : 1;
  if (argument.type === "number") return argument.minimum ?? 1;
  if (argument.type === "boolean") return false;
  if (argument.type === "enum" && argument.choices?.length) return argument.choices[0];
  return "";
}

/** Order derived variables so dependencies evaluate first (Kahn's algorithm). */
function evaluationOrder(
  parsed: Map<string, ReturnType<typeof parse>>,
  problems: Map<string, string>,
): string[] {
  const dependencies = new Map(
    [...parsed.entries()].map(([name, expr]) => [
      name,
      new Set([...references(expr)].filter((ref) => parsed.has(ref))),
    ]),
  );
  const ordered: string[] = [];
  const satisfied = new Set<string>();
  const pending = new Map(dependencies);
  while (pending.size > 0) {
    const ready = [...pending.entries()]
      .filter(([, deps]) => [...deps].every((dep) => satisfied.has(dep)))
      .map(([name]) => name)
      .sort();
    if (ready.length === 0) {
      for (const name of pending.keys()) {
        problems.set(name, "Variables form a reference cycle.");
      }
      break;
    }
    for (const name of ready) {
      ordered.push(name);
      satisfied.add(name);
      pending.delete(name);
    }
  }
  return ordered;
}

/**
 * Build the static environment from declared arguments and panel variables.
 * Never throws: per-variable failures land in `problems` so the panel can
 * annotate the offending row while the rest of the environment stays usable.
 */
export function buildStaticEnvironment(
  argumentsList: PipelineInputArgument[],
  variables: PipelineVariable[],
): StaticEnvironment {
  const types = new Map<string, ExprType>([[QUERY_VARIABLE, "string"]]);
  const values = new Map<string, ExprValue>([[QUERY_VARIABLE, ""]]);
  const tainted = new Set<string>([QUERY_VARIABLE]);
  const problems = new Map<string, string>();

  for (const argument of argumentsList) {
    if (types.has(argument.name)) continue;
    types.set(argument.name, exprTypeOf(argument.type));
    values.set(argument.name, argumentPlaceholder(argument));
    tainted.add(argument.name);
  }

  const declared = new Map<string, PipelineVariable>();
  for (const variable of variables) {
    if (types.has(variable.name) || declared.has(variable.name)) continue;
    declared.set(variable.name, variable);
    types.set(variable.name, exprTypeOf(variable.type));
  }

  const parsed = new Map<string, ReturnType<typeof parse>>();
  for (const [name, variable] of declared) {
    if (variable.expression == null) {
      if (variable.value != null) {
        values.set(name, variable.value as ExprValue);
      } else {
        problems.set(name, "Set a value or an expression.");
      }
      continue;
    }
    try {
      parsed.set(name, parse(variable.expression));
    } catch (error) {
      if (error instanceof ExpressionError) problems.set(name, error.message);
      else throw error;
    }
  }

  for (const name of evaluationOrder(parsed, problems)) {
    const expression = parsed.get(name);
    if (!expression) continue;
    const refs = references(expression);
    if ([...refs].some((ref) => tainted.has(ref))) tainted.add(name);
    try {
      checkType(expression, types);
      values.set(name, evaluate(expression, values));
    } catch (error) {
      if (error instanceof ExpressionError) problems.set(name, error.message);
      else throw error;
    }
  }

  return { types, values, tainted, problems };
}

/** Format an evaluated value for a compact preview. */
export function formatPreviewValue(value: ExprValue | undefined): string {
  if (value === undefined) return "—";
  if (typeof value === "object") return value.model_name;
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toPrecision(6).replace(/\.?0+$/, "");
  return String(value);
}
