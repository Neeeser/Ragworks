import { resolveNodeFamily } from "./pipeline-theme";

import type { NodeFamily } from "./pipeline-theme";
import type { StripStage } from "@/components/ui/stage-strip";
import type { PipelineDefinition } from "@/lib/types";

/**
 * Families that name a real processing stage. Container families
 * (`ingestion`/`retrieval` boundary nodes) and `utility`/`other` deliberately
 * map to nothing: a strip is metadata about what the pipeline *does*, and a
 * dot for "this graph has an input node" says nothing.
 */
const FAMILY_STAGE: Partial<Record<NodeFamily, StripStage>> = {
  parser: "parse",
  chunker: "chunk",
  embedder: "embed",
  indexer: "index",
  retriever: "retrieve",
  ranking: "rerank",
  router: "router",
  chat: "chat",
};

/** The order a strip reads in, so two pipelines with the same stages match. */
const STAGE_ORDER: StripStage[] = [
  "parse",
  "chunk",
  "embed",
  "index",
  "router",
  "retrieve",
  "rerank",
  "chat",
];

/**
 * The stages a saved definition actually contains, in flow order.
 *
 * Derived from the definition's node types rather than stored, so the strip
 * can never claim a stage the graph does not have — the supporting signature
 * mark only appears where a real pipeline backs it.
 */
export function pipelineStages(definition: PipelineDefinition | undefined): StripStage[] {
  const present = new Set<StripStage>();
  for (const node of definition?.nodes ?? []) {
    const stage = FAMILY_STAGE[resolveNodeFamily(node.type)];
    if (stage) present.add(stage);
  }
  return STAGE_ORDER.filter((stage) => present.has(stage));
}
