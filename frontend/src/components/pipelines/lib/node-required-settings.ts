import { resolveNodeSignature } from "./node-signature";
import { buildPipelineConfigFields } from "./pipeline-config";
import { resolveNodeFamily } from "./pipeline-theme";

import type { PipelineNodeData } from "../PipelineNode";

const blank = (value: unknown) => typeof value !== "string" || value.trim() === "";

/**
 * Whether a node still needs a decision before it can run: the model or index
 * that identifies it carries no value.
 *
 * The node card's own signature readout is the source, so this answers yes for
 * exactly the nodes whose card prints "no model selected" / "no index
 * selected". LLM shells have no signature readout, so their model pair is
 * checked directly.
 */
export const hasUnsetRequiredSetting = (data: PipelineNodeData): boolean => {
  const config = data.config ?? {};
  const fields = buildPipelineConfigFields(data.configSchema);
  if (resolveNodeSignature(data.nodeType, config, fields)?.missing) return true;
  if (resolveNodeFamily(data.nodeType) !== "llm") return false;
  return blank(config.model_name);
};
