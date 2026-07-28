import { evaluate, expressionSource, parse } from "@/lib/expressions";
import { roundHalfAway } from "@/lib/expressions/functions";

import type { ParameterSelectOption } from "@/components/ui/parameter-controls";
import type { ExprType, ExprValue } from "@/lib/expressions";
import type { ParameterInputKind } from "@/lib/types";

export type PipelineConfigField = {
  key: string;
  label: string;
  description?: string;
  input: ParameterInputKind;
  options?: ParameterSelectOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  defaultValue?: unknown;
  nullable: boolean;
  required: boolean;
  /** Identity field (index name, backend, dimension): expressions on it may
   * not depend on caller input. Mirrors the backend `static_only` marker. */
  staticOnly: boolean;
  /** Expression the ƒx toggle starts from, when the node declares one. */
  exprSeed?: string;
  /** Expression type the field accepts in expression mode; null = no ƒx toggle. */
  exprType: "integer" | "number" | "string" | "boolean" | null;
};

type JsonSchema = Record<string, unknown>;

const toTitleCase = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatEnumLabel = (value: string) => {
  if (value.toUpperCase() === value) {
    return value;
  }
  return toTitleCase(value);
};

const getSchemaDefs = (schema: JsonSchema) => {
  const defs = schema.$defs ?? schema.definitions;
  return defs && typeof defs === "object" ? (defs as Record<string, JsonSchema>) : {};
};

const resolveRef = (schema: JsonSchema, defs: Record<string, JsonSchema>) => {
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  const key = ref.split("/").pop();
  if (!key) return schema;
  return defs[key] ?? schema;
};

const resolveNullableType = (schema: JsonSchema) => {
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((item) => item !== "null");
    return {
      type: (types[0] as string | undefined) ?? undefined,
      nullable: schema.type.includes("null"),
    };
  }
  return {
    type: typeof schema.type === "string" ? schema.type : undefined,
    nullable: false,
  };
};

const resolveSchemaNode = (
  schema: JsonSchema,
  defs: Record<string, JsonSchema>,
): { node: JsonSchema; nullable: boolean } => {
  let current = resolveRef(schema, defs);
  let nullable = false;

  if (Array.isArray(current.allOf) && current.allOf.length > 0) {
    const resolved = resolveSchemaNode(current.allOf[0] as JsonSchema, defs);
    current = resolved.node;
    nullable = resolved.nullable;
  }

  if (Array.isArray(current.anyOf) || Array.isArray(current.oneOf)) {
    const variants = (current.anyOf ?? current.oneOf) as JsonSchema[];
    let selected: JsonSchema | null = null;
    let nullableVariant = false;
    for (const variant of variants) {
      const resolved = resolveSchemaNode(variant, defs);
      const { type } = resolveNullableType(resolved.node);
      if (type === "null") {
        nullableVariant = true;
        continue;
      }
      if (!selected) {
        selected = resolved.node;
        nullableVariant = nullableVariant || resolved.nullable;
      }
    }
    if (selected) {
      current = selected;
      nullable = nullable || nullableVariant;
    }
  }

  const resolvedType = resolveNullableType(current);
  nullable = nullable || resolvedType.nullable;
  return { node: current, nullable };
};

const resolveInputType = (schema: JsonSchema): ParameterInputKind => {
  const { type } = resolveNullableType(schema);
  if (Array.isArray(schema.enum)) {
    return "select";
  }
  if (type === "integer") return "integer";
  if (type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array" || type === "object") return "json";
  return "text";
};

export const buildPipelineConfigFields = (schema?: Record<string, unknown>) => {
  if (!schema) return [];
  const root = schema as JsonSchema;
  const defs = getSchemaDefs(root);
  const properties = root.properties && typeof root.properties === "object" ? root.properties : {};
  const requiredSet = new Set(Array.isArray(root.required) ? (root.required as string[]) : []);

  return Object.entries(properties as Record<string, JsonSchema>).map(([key, rawSchema]) => {
    const { node, nullable } = resolveSchemaNode(rawSchema, defs);
    const input = resolveInputType(node);
    const label = typeof node.title === "string" ? node.title : toTitleCase(key);
    const description = typeof node.description === "string" ? node.description : undefined;
    const defaultValue = node.default;
    const options = Array.isArray(node.enum)
      ? (node.enum as Array<string | number>).map((value) => ({
          value: String(value),
          label: formatEnumLabel(String(value)),
        }))
      : undefined;

    const examples = Array.isArray(node.examples) ? node.examples : undefined;
    // json_schema_extra lands on the outer property, even when the type
    // resolves through anyOf/$ref.
    const staticOnly = rawSchema.static_only === true || node.static_only === true;
    const seed = rawSchema.expr_seed ?? node.expr_seed;

    return {
      key,
      label,
      description,
      input,
      options,
      min: typeof node.minimum === "number" ? node.minimum : undefined,
      max: typeof node.maximum === "number" ? node.maximum : undefined,
      step: typeof node.multipleOf === "number" ? node.multipleOf : undefined,
      placeholder: typeof examples?.[0] === "string" ? (examples[0] as string) : undefined,
      defaultValue,
      nullable,
      required: requiredSet.has(key),
      staticOnly,
      exprSeed: typeof seed === "string" ? seed : undefined,
      exprType: expressionTypeFor(input),
    };
  });
};

/** Expression type a field accepts in ƒx mode; json/list fields get none. */
const expressionTypeFor = (input: ParameterInputKind): PipelineConfigField["exprType"] => {
  if (input === "integer") return "integer";
  if (input === "number") return "number";
  if (input === "boolean") return "boolean";
  if (input === "text" || input === "select") return "string";
  return null;
};

export const formatConfigValue = (value: unknown) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/** Reads the current value for a config field out of a draft/config record, falling back
 * to the field's schema default (or "") when the key hasn't been set yet. */
export const getInputValue = (field: PipelineConfigField, config: Record<string, unknown>) => {
  if (Object.prototype.hasOwnProperty.call(config, field.key)) {
    return config[field.key];
  }
  return field.defaultValue ?? "";
};

/** Coerces a raw control value (string from a text/number input, or boolean from a
 * checkbox) into the value that should be stored for a config field, returning
 * `undefined` when the field should be cleared from the config record entirely. */
export const coerceFieldValue = (field: PipelineConfigField, raw: string | boolean): unknown => {
  if (field.input === "number" || field.input === "integer") {
    if (raw === "") {
      return undefined;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    return field.input === "integer" ? Math.trunc(parsed) : parsed;
  }
  if (field.input === "boolean") {
    return raw === true;
  }
  if (raw === "" && field.nullable) {
    return undefined;
  }
  return raw;
};

/**
 * The `self.<field>` scope for one field of a node: sibling types from the
 * schema, sibling values from the node's config (falling back to each field's
 * default, which is what the node will actually run with).
 *
 * Expression-valued siblings are omitted rather than guessed: their value is
 * decided during resolution, and showing a preview computed from a placeholder
 * would state a number the run will not produce.
 */
export function buildSelfScope(
  fields: PipelineConfigField[],
  config: Record<string, unknown>,
  key: string,
): { types: Map<string, ExprType>; values: Map<string, ExprValue>; key: string } {
  const types = new Map<string, ExprType>();
  const values = new Map<string, ExprValue>();
  for (const field of fields) {
    if (field.exprType !== null) types.set(field.key, field.exprType);
    const raw = config[field.key] ?? field.defaultValue;
    if (expressionSource(config[field.key]) !== null) continue;
    if (typeof raw === "number" || typeof raw === "string" || typeof raw === "boolean") {
      values.set(field.key, raw);
    }
  }
  return { types, values, key };
}

/**
 * A config value as a number, evaluating an expression when it holds one.
 *
 * Returns null when the value cannot be known without a run — an expression
 * over a caller-supplied argument, or one that does not type-check. Callers
 * state that honestly rather than showing a number the run will not produce.
 */
export function resolvedNumber(
  key: string,
  fields: PipelineConfigField[],
  config: Record<string, unknown>,
  env: { values: ReadonlyMap<string, ExprValue> },
): number | null {
  const raw = config[key] ?? fields.find((field) => field.key === key)?.defaultValue;
  if (typeof raw === "number") return raw;
  const source = expressionSource(config[key]);
  if (source === null) return null;
  try {
    const scope = buildSelfScope(fields, config, key);
    const result = evaluate(parse(source), env.values, scope.values);
    if (typeof result !== "number") return null;
    // Report the value that will be stored: an integer field rounds.
    const field = fields.find((candidate) => candidate.key === key);
    return field?.exprType === "integer" ? roundHalfAway(result) : result;
  } catch {
    return null;
  }
}
