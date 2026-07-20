/** Builders for eval domain objects. */

import type { EvalRunItem, EvalRunSummary, FunnelStage } from "@/lib/types";

export function makeEvalRunSummary(overrides: Partial<EvalRunSummary> = {}): EvalRunSummary {
  return {
    id: "run-1",
    name: "SciFact · Quick",
    dataset_id: "ds-1",
    status: "completed",
    progress_done: 52,
    progress_total: 52,
    failed_count: 0,
    coverage: {
      corpus_ingested: 302,
      corpus_total: 5183,
      queries_done: 50,
      queries_total: 300,
    },
    aggregate_metrics: { "recall@10": 0.9 },
    created_at: "2026-07-19T12:00:00Z",
    ...overrides,
  };
}

export function makeFunnelStage(overrides: Partial<FunnelStage> = {}): FunnelStage {
  return {
    node_id: "vector-retriever",
    node_type: "retriever.pgvector",
    label: "Semantic Retriever",
    gold_retained: 8,
    gold_total: 10,
    retention: 0.8,
    ...overrides,
  };
}

export function makeEvalRunItem(overrides: Partial<EvalRunItem> = {}): EvalRunItem {
  return {
    id: "item-1",
    query_external_id: "q1",
    query_text: "capital of France",
    pipeline_run_id: "run-1",
    query_event_id: "qe-1",
    result_count: 2,
    gold_doc_ids: ["docA"],
    retrieved_document_ids: ["docA", "docB"],
    retrieved: [
      { chunk_id: "uuid-a:0", document_id: "docA", score: 0.91 },
      { chunk_id: "uuid-b:0", document_id: "docB", score: 0.42 },
    ],
    per_node_funnel: [
      { node_id: "ingestion", document_ids: ["docA"] },
      { node_id: "vector-retriever", document_ids: ["docA", "docB"] },
    ],
    metrics: { "recall@10": 1.0, "mrr@10": 1.0 },
    failed: false,
    error_message: null,
    ...overrides,
  };
}
