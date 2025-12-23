import type { ParameterInputType, ParameterSelectOption } from "@/components/ui/parameter-controls";

export type PipelineConfigField = {
  key: string;
  label: string;
  description?: string;
  input: ParameterInputType;
  options?: ParameterSelectOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  defaultValue?: unknown;
  nullable: boolean;
  required: boolean;
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

const resolveInputType = (schema: JsonSchema): ParameterInputType => {
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
    };
  });
};

export const formatConfigValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
