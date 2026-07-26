/**
 * Static variable environments for the editor, mirroring the backend's
 * `default_environment` semantics (`app/pipelines/environment.py`): the
 * built-in `query`, the built-in collection descriptors, every input-source
 * variable (default or a constraint-respecting placeholder — tainted, since
 * callers supply them), every binding-source variable at its default, and
 * every other variable (constants validated, derived expressions evaluated in
 * dependency order). Powers live expression type checks and value previews
 * before anything is saved.
 *
 * Binding values and collection descriptors are deliberately untainted: both
 * are fixed when a pipeline is bound to a collection, so an index name
 * derived from them still resolves to one index per binding.
 */

import {
  checkType,
  evaluate,
  expressionSource,
  parse,
  references,
  ExpressionError,
} from "@/lib/expressions";

import type { ExprType, ExprValue } from "@/lib/expressions";
import type { PipelineVariable, VariableSource, VariableType } from "@/lib/types";

export const QUERY_VARIABLE = "query";
export const RETRIEVAL_INPUT_TYPE = "retrieval.input";
export const RETRIEVAL_OUTPUT_TYPE = "retrieval.output";

/** Built-in strings describing the collection a pipeline is bound to. */
export const COLLECTION_VARIABLES = ["collection_id", "collection_name", "user_id"] as const;

export const VARIABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;
export const RESERVED_VARIABLE_NAMES = new Set([
  QUERY_VARIABLE,
  ...COLLECTION_VARIABLES,
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
  { value: "index", label: "Index" },
];

export function exprTypeOf(type: VariableType): ExprType {
  if (type === "enum") return "string";
  return type;
}

type NodeLike = { type: string; config: Record<string, unknown> };

/** The variable's effective source (older payloads may omit the field). */
export function variableSource(variable: PipelineVariable): VariableSource {
  if (variable.source) return variable.source;
  return variable.expression != null ? "expression" : "value";
}

/** The binding-source variables, in declaration order. */
export function bindingVariables(variables: PipelineVariable[]): PipelineVariable[] {
  return variables.filter((variable) => variableSource(variable) === "binding");
}

/** The binding-source index variables — the index slots a collection fills. */
export function indexVariables(variables: PipelineVariable[]): PipelineVariable[] {
  return bindingVariables(variables).filter((variable) => variable.type === "index");
}

/** The input-source variables, in declaration order. */
export function inputVariables(variables: PipelineVariable[]): PipelineVariable[] {
  return variables.filter((variable) => variableSource(variable) === "input");
}

/** The variable names the retrieval.input node(s) accept from callers. */
export function acceptedArgumentNames(nodes: NodeLike[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.type !== RETRIEVAL_INPUT_TYPE) continue;
    const raw = node.config.arguments;
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      if (typeof entry === "string" && !seen.has(entry)) {
        seen.add(entry);
        names.push(entry);
      }
    }
  }
  return names;
}

export interface StaticEnvironment {
  types: Map<string, ExprType>;
  values: Map<string, ExprValue>;
  /** Names that derive (transitively) from caller input — the taint set. */
  tainted: Set<string>;
  /** Per-variable problems found while building the environment. */
  problems: Map<string, string>;
  /** Each name's source — powers the suggestion dropdown's badges. */
  sources: Map<string, VariableSource>;
}

function inputPlaceholder(variable: PipelineVariable): ExprValue {
  if (
    variable.value !== null &&
    variable.value !== undefined &&
    typeof variable.value !== "object"
  ) {
    return variable.value;
  }
  if (variable.type === "integer")
    return variable.minimum != null ? Math.trunc(variable.minimum) : 1;
  if (variable.type === "number") return variable.minimum ?? 1;
  if (variable.type === "boolean") return false;
  if (variable.type === "enum" && variable.choices?.length) return variable.choices[0];
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
 * Build the static environment from the definition's variables (input-source
 * ones included). Never throws: per-variable failures land in `problems` so
 * the panel can annotate the offending row while the rest of the environment
 * stays usable.
 */
export function buildStaticEnvironment(variables: PipelineVariable[]): StaticEnvironment {
  const types = new Map<string, ExprType>([[QUERY_VARIABLE, "string"]]);
  const values = new Map<string, ExprValue>([[QUERY_VARIABLE, ""]]);
  const tainted = new Set<string>([QUERY_VARIABLE]);
  const problems = new Map<string, string>();
  const sources = new Map<string, VariableSource>([[QUERY_VARIABLE, "input"]]);

  // Collection descriptors are always in scope and never tainted: they are
  // fixed when the pipeline is bound, so an identity field may derive from
  // them without breaking the static-only rule.
  for (const name of COLLECTION_VARIABLES) {
    types.set(name, "string");
    values.set(name, "");
    sources.set(name, "value");
  }

  for (const variable of inputVariables(variables)) {
    if (types.has(variable.name)) continue;
    types.set(variable.name, exprTypeOf(variable.type));
    values.set(variable.name, inputPlaceholder(variable));
    tainted.add(variable.name);
    sources.set(variable.name, "input");
  }

  // Binding variables resolve to their default here: the editor has no
  // collection, and the default is what every binding starts from.
  for (const variable of bindingVariables(variables)) {
    if (types.has(variable.name)) continue;
    types.set(variable.name, exprTypeOf(variable.type));
    sources.set(variable.name, "binding");
    if (variable.value != null) values.set(variable.name, variable.value as ExprValue);
  }

  const declared = new Map<string, PipelineVariable>();
  for (const variable of variables) {
    const source = variableSource(variable);
    if (source === "input" || source === "binding") continue;
    if (types.has(variable.name) || declared.has(variable.name)) continue;
    declared.set(variable.name, variable);
    types.set(variable.name, exprTypeOf(variable.type));
    sources.set(variable.name, variableSource(variable));
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

  return { types, values, tainted, problems, sources };
}

/** Format an evaluated value for a compact preview. */
export function formatPreviewValue(value: ExprValue | undefined): string {
  if (value === undefined) return "—";
  if (typeof value === "object") return "name" in value ? value.name : value.model_name;
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toPrecision(6).replace(/\.?0+$/, "");
  return String(value);
}

/**
 * The variable names an expression-tagged config value reads, or null when the
 * value is a plain literal.
 *
 * A store-bound node's index identity is an expression over a binding index
 * variable, so this is what separates "the collection sets this" from "nothing
 * is set" — reading such a value as a missing string reports a correct,
 * normal pipeline as misconfigured. An expression that fails to parse yields
 * an empty list: still bound, just not nameable.
 */
export function expressionVariableNames(value: unknown): string[] | null {
  const source = expressionSource(value);
  if (source === null) return null;
  try {
    return [...references(parse(source))];
  } catch {
    return [];
  }
}

/** Mirrors `app/pipelines/index_variables.py::_LEXICAL_NODE_TYPES` — the
 * BM25/lexical node family, whose index slots need a sparse index. */
const LEXICAL_NODE_TYPES = new Set(["indexer.bm25", "retriever.bm25", "count.bm25", "facet.bm25"]);

export interface IndexSlotConstraint {
  /** "dense" | "sparse", derived from the nodes reading the slot (sparse wins). */
  vectorType: string;
  /** The width a compatible dense index must store, when the definition states one. */
  dimension: number | null;
}

type PipelineLike = {
  definition: {
    nodes?: Array<{ type: string; config?: Record<string, unknown> | null }>;
    variables?: PipelineVariable[];
  };
};

/**
 * Per-slot compatibility constraints, derived the same way the backend does:
 * vector type from the nodes that reference the slot (never its name), and
 * dimension from any node config that states one. The server re-checks on
 * save — this only keeps the picker from offering choices the save rejects.
 */
export function indexSlotConstraints(pipelines: PipelineLike[]): Map<string, IndexSlotConstraint> {
  const constraints = new Map<string, IndexSlotConstraint>();
  for (const pipeline of pipelines) {
    let statedDimension: number | null = null;
    const referenced = new Map<string, boolean>(); // slot -> any lexical reader
    for (const node of pipeline.definition.nodes ?? []) {
      const config = node.config ?? {};
      const dimension = config["dimension"];
      if (typeof dimension === "number") statedDimension = dimension;
      const lexical = LEXICAL_NODE_TYPES.has(node.type);
      for (const value of Object.values(config)) {
        const source = expressionSource(value);
        if (source === null) continue;
        let refs: Set<string>;
        try {
          refs = references(parse(source));
        } catch {
          continue;
        }
        for (const name of refs) {
          referenced.set(name, lexical || (referenced.get(name) ?? false));
        }
      }
    }
    for (const variable of indexVariables(pipeline.definition.variables ?? [])) {
      const lexical = referenced.get(variable.name) ?? false;
      const existing = constraints.get(variable.name);
      constraints.set(variable.name, {
        vectorType: lexical || existing?.vectorType === "sparse" ? "sparse" : "dense",
        dimension: existing?.dimension ?? (lexical ? null : statedDimension),
      });
    }
  }
  return constraints;
}
