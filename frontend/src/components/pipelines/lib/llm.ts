import type { CatalogModel, LlmOutputField, LlmOutputTarget } from "@/lib/types";

/** The three LLM node shells (see `app/pipelines/nodes/llm_*.py`). */
export const LLM_TRANSFORM_TYPE = "llm.transform";
export const LLM_RERANK_TYPE = "llm.rerank";
export const LLM_GENERATE_TYPE = "llm.generate";

export const isLlmNodeType = (nodeType: string) => nodeType.startsWith("llm.");

/**
 * Write targets each shell's output fields may declare — mirrors the
 * backend's `ShellRules`; validation there is the hard gate, this only
 * keeps the builder from offering targets that would immediately error.
 */
export const allowedTargets = (nodeType: string): LlmOutputTarget["kind"][] => {
  if (nodeType === LLM_RERANK_TYPE) return ["score", "metadata"];
  if (nodeType === LLM_GENERATE_TYPE) return ["items"];
  return ["metadata", "text"];
};

/**
 * Chat models able to enforce a structured output shape — `response_format`
 * with a strict schema, or a forced tool call. The house rule: pickers for
 * structured-output tasks surface only models advertising support.
 */
export const structuredOutputCapable = (model: CatalogModel): boolean =>
  model.supported_parameters.includes("response_format") || model.capabilities?.tools === true;

const isTargetKind = (value: unknown): value is LlmOutputTarget["kind"] =>
  value === "metadata" || value === "text" || value === "score" || value === "items";

/** Parse the config's `output_fields` list, dropping malformed entries. */
export const outputFieldsFromConfig = (config: Record<string, unknown>): LlmOutputField[] => {
  const raw = config.output_fields;
  if (!Array.isArray(raw)) return [];
  const fields: LlmOutputField[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const target = record.target as Record<string, unknown> | undefined;
    if (!target || !isTargetKind(target.kind)) continue;
    fields.push({
      name: typeof record.name === "string" ? record.name : "",
      type:
        record.type === "number" || record.type === "boolean" || record.type === "string_list"
          ? record.type
          : "string",
      description: typeof record.description === "string" ? record.description : "",
      target: normalizeTarget(target),
    });
  }
  return fields;
};

const normalizeTarget = (target: Record<string, unknown>): LlmOutputTarget => {
  switch (target.kind) {
    case "metadata":
      return { kind: "metadata", key: typeof target.key === "string" ? target.key : "" };
    case "text":
      return {
        kind: "text",
        mode: target.mode === "prepend" || target.mode === "append" ? target.mode : "replace",
        separator: typeof target.separator === "string" ? target.separator : "\n\n",
      };
    case "score":
      return { kind: "score" };
    default:
      return { kind: "items" };
  }
};

/** A fresh field for the builder's "Add field" action. */
export const emptyFieldForTargets = (kinds: LlmOutputTarget["kind"][]): LlmOutputField => {
  const kind = kinds[0];
  if (kind === "score")
    return { name: "score", type: "number", description: "", target: { kind: "score" } };
  if (kind === "items")
    return { name: "results", type: "string_list", description: "", target: { kind: "items" } };
  return { name: "", type: "string", description: "", target: { kind: "metadata", key: "" } };
};

export const emptyOutputField = (nodeType: string): LlmOutputField =>
  emptyFieldForTargets(allowedTargets(nodeType));
