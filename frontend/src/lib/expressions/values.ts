/**
 * Value and type domain for pipeline expressions — the TypeScript mirror of
 * `app/pipelines/expressions/values.py`. JavaScript has one number type, so
 * a runtime number counts as `integer` when `Number.isInteger` holds; the
 * static checker is the authority on integer-vs-number typing.
 */

export type ExprType =
  | "integer"
  | "number"
  | "string"
  | "boolean"
  | "model"
  | "index"
  | "item"
  | "metadata";

export interface ModelValue {
  connection_id: string;
  model_name: string;
}

export interface IndexValue {
  index_id: string;
  backend: string;
  name: string;
}

/**
 * One item's metadata, read as strings by open-ended member access.
 *
 * Every member types `string` because metadata keys are the corpus's, not the
 * schema's — nothing can enumerate them, so a fixed member map would have to
 * be wrong. An absent key reads as the empty string rather than raising: a
 * heterogeneous corpus routinely holds items that carry a key and items that
 * do not, and failing the run on the second kind would make every metadata
 * predicate unusable on real data.
 */
export interface MetadataValue {
  data: Record<string, string>;
}

/**
 * The item an expression is being evaluated against: the facets it actually
 * carries (`has_*`), its text and score, and its metadata.
 */
export interface ItemValue {
  id: string;
  document_id: string;
  text: string;
  text_length: number;
  score: number;
  has_file: boolean;
  has_text: boolean;
  has_image: boolean;
  has_embedding: boolean;
  has_score: boolean;
  metadata: MetadataValue;
}

export type ExprValue =
  | number
  | string
  | boolean
  | ModelValue
  | IndexValue
  | ItemValue
  | MetadataValue;

/**
 * Qualifier for a node's *own* config fields: `self.chunk_size`.
 *
 * A scope, not a value — its members are the config fields of whichever node
 * the expression sits on, so they vary per node rather than coming from a
 * fixed member map. Mirrors `SELF_SCOPE` in
 * `app/pipelines/expressions/values.py`.
 */
export const SELF_SCOPE = "self";

export const MODEL_MEMBERS: Record<string, ExprType> = {
  connection_id: "string",
  model_name: "string",
};

export const INDEX_MEMBERS: Record<string, ExprType> = {
  id: "string",
  backend: "string",
  name: "string",
};

export const ITEM_MEMBERS: Record<string, ExprType> = {
  id: "string",
  document_id: "string",
  text: "string",
  text_length: "integer",
  score: "number",
  has_file: "boolean",
  has_text: "boolean",
  has_image: "boolean",
  has_embedding: "boolean",
  has_score: "boolean",
  metadata: "metadata",
};

/**
 * The fixed member-access surface, keyed by the structured type that owns it.
 *
 * `metadata` is absent on purpose: its keys come from the corpus, so it is
 * typed by the open-key rule below rather than by a member map.
 */
export const MEMBERS_BY_TYPE: Partial<Record<ExprType, Record<string, ExprType>>> = {
  model: MODEL_MEMBERS,
  index: INDEX_MEMBERS,
  item: ITEM_MEMBERS,
};

/** Types whose members are open-ended, and what every one of them types as. */
export const OPEN_MEMBER_TYPES: Partial<Record<ExprType, ExprType>> = {
  metadata: "string",
};

export function isNumericType(type: ExprType): boolean {
  return type === "integer" || type === "number";
}

export function isIndexValue(value: ExprValue): value is IndexValue {
  return typeof value === "object" && value !== null && "index_id" in value;
}

export function isItemValue(value: ExprValue): value is ItemValue {
  return typeof value === "object" && value !== null && "has_text" in value;
}

export function isMetadataValue(value: ExprValue): value is MetadataValue {
  return typeof value === "object" && value !== null && "data" in value;
}

export function isModelValue(value: ExprValue): value is ModelValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !isIndexValue(value) &&
    !isItemValue(value) &&
    !isMetadataValue(value)
  );
}

/** Read one declared member off an item value. */
export function itemMember(value: ItemValue, name: string): ExprValue {
  return value[name as keyof ItemValue];
}

/** Read a metadata key; an absent one reads as the empty string. */
export function metadataRead(value: MetadataValue, key: string): string {
  return value.data[key] ?? "";
}

export function valueType(value: ExprValue): ExprType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (isIndexValue(value)) return "index";
  if (isItemValue(value)) return "item";
  if (isMetadataValue(value)) return "metadata";
  return "model";
}

/**
 * Whether a result of `result` can be stored in a field expecting `expected`.
 * Integers satisfy number fields; everything else must match exactly. Mirrors
 * `is_assignable` in `app/pipelines/expressions/values.py`.
 */
export function isAssignableType(result: ExprType, expected: ExprType): boolean {
  return result === expected || (result === "integer" && expected === "number");
}
