/** Pure derivation of per-gold-document stage journeys from item trace data. */

import type { EvalRunItem, FunnelStage } from "@/lib/types";

export interface DocStageStep {
  nodeId: string;
  /** Display name of the stage (node name, or "Indexed" for ingestion). */
  label: string;
  /** Whether the document was present in this stage's emitted list. */
  present: boolean;
  /** 1-based rank within the stage's ordered list, when present. */
  rank: number | null;
}

export interface GoldDocJourney {
  documentId: string;
  steps: DocStageStep[];
  /** 1-based rank in the final retrieved list, or null when never returned. */
  finalRank: number | null;
  /** The first stage that lost the document after it existed upstream. */
  droppedAt: string | null;
}

const INGESTION_NODE_ID = "ingestion";

/**
 * One gold document's path across the run's funnel stages.
 *
 * Stage order and labels come from the run-level funnel; presence and rank
 * come from the item's per-node document lists. A stage the item has no
 * record for is skipped rather than shown as a false drop.
 */
export function goldDocJourney(
  documentId: string,
  stages: FunnelStage[],
  item: EvalRunItem,
): GoldDocJourney {
  const listsByNode = new Map(item.per_node_funnel.map((entry) => [entry.node_id, entry]));
  const steps: DocStageStep[] = [];
  for (const stage of stages) {
    const entry = listsByNode.get(stage.node_id);
    if (!entry) continue;
    const index = entry.document_ids.indexOf(documentId);
    steps.push({
      nodeId: stage.node_id,
      label: stage.node_id === INGESTION_NODE_ID ? "Indexed" : stage.label,
      present: index >= 0,
      // Ingestion coverage is membership, not an ordering — no rank there.
      rank: index >= 0 && stage.node_id !== INGESTION_NODE_ID ? index + 1 : null,
    });
  }
  const finalIndex = item.retrieved_document_ids.indexOf(documentId);
  return {
    documentId,
    steps,
    finalRank: finalIndex >= 0 ? finalIndex + 1 : null,
    // A retrieved document was never lost; absences along the way were
    // parallel branches (e.g. missing from BM25 but carried by the dense
    // retriever), which the steps themselves still show honestly.
    droppedAt: finalIndex >= 0 ? null : dropStage(steps),
  };
}

/** Journeys for every gold document of an item, in gold order. */
export function goldDocJourneys(stages: FunnelStage[], item: EvalRunItem): GoldDocJourney[] {
  return item.gold_doc_ids.map((documentId) => goldDocJourney(documentId, stages, item));
}

/**
 * The stage that actually lost a never-retrieved document: the first absence
 * after its last presence (earlier absences are parallel branches), or the
 * first stage when it never appeared anywhere.
 */
function dropStage(steps: DocStageStep[]): string | null {
  let lastPresent = -1;
  steps.forEach((step, index) => {
    if (step.present) lastPresent = index;
  });
  if (lastPresent === -1) return steps[0]?.label ?? null;
  for (let index = lastPresent + 1; index < steps.length; index += 1) {
    if (!steps[index].present) return steps[index].label;
  }
  return null;
}

/** How many of the item's gold documents appear in its final results. */
export function goldHitCount(item: EvalRunItem): number {
  const retrieved = new Set(item.retrieved_document_ids);
  return item.gold_doc_ids.filter((id) => retrieved.has(id)).length;
}

/** The best (chunk-level) score and chunk id a document reached in the results. */
export function bestChunkFor(
  item: EvalRunItem,
  documentId: string,
): { chunkId: string | null; score: number | null } | null {
  for (const chunk of item.retrieved) {
    if (chunk.document_id === documentId) {
      return { chunkId: chunk.chunk_id ?? null, score: chunk.score ?? null };
    }
  }
  return null;
}
