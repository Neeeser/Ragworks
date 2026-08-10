/** Builders for eval domain objects. */

import type {
  EvalComparisonSide,
  EvalDataset,
  EvalDatasetQuery,
  EvalRunComparison,
  EvalRun,
  EvalRunItem,
  EvalRunSummary,
  FunnelStage,
} from "@/lib/types";

const RUN_CREATED_AT = "2026-07-19T12:00:00Z";

export function makeEvalDataset(overrides: Partial<EvalDataset> = {}): EvalDataset {
  return {
    id: "ds-1",
    name: "Synthetic set",
    description: null,
    source: "synthetic",
    source_ref: "col-1",
    relevance_granularity: "document",
    status: "ready",
    error_message: null,
    num_queries: 50,
    num_corpus_docs: 40,
    progress_done: 50,
    progress_total: 50,
    generation_config: { models: { text: { connection_id: "conn-1", model_name: "test/model" } } },
    modalities: ["text"],
    created_at: "2026-07-21T12:00:00Z",
    updated_at: "2026-07-21T12:10:00Z",
    ...overrides,
  };
}

export function makeEvalDatasetQuery(overrides: Partial<EvalDatasetQuery> = {}): EvalDatasetQuery {
  return {
    id: "q-1",
    external_query_id: "synth-0001",
    text: "How many retries does the alpha subsystem attempt?",
    question_type: "single_fact",
    scores: { groundedness: 5, standalone: 4, realism: 4 },
    quote: "retries twice before failing over",
    gold: [{ external_doc_id: "doc-1", title: "alpha.md" }],
    ...overrides,
  };
}

export function makeEvalRunSummary(overrides: Partial<EvalRunSummary> = {}): EvalRunSummary {
  return {
    id: "run-1",
    name: "SciFact · Quick",
    dataset_id: "ds-1",
    status: "completed",
    progress_done: 52,
    progress_total: 52,
    failed_count: 0,
    unscored_count: 0,
    degraded_count: 0,
    coverage: {
      corpus_ingested: 302,
      corpus_total: 5183,
      corpus_unindexed: 0,
      queries_done: 50,
      queries_total: 300,
    },
    aggregate_metrics: { "recall@10": 0.9 },
    created_at: RUN_CREATED_AT,
    ...overrides,
  };
}

export function makeEvalRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "run-1",
    name: "SciFact · Quick",
    dataset_id: "ds-1",
    eval_collection_id: "col-1",
    ingestion_pipeline_id: "pipe-ing",
    retrieval_pipeline_id: "pipe-ret",
    status: "completed",
    config: {
      num_queries: 50,
      distractor_pool_size: 100,
      seed: 0,
      concurrency: 4,
      k_values: [1, 5, 10],
      selected_metrics: [],
      run_inputs: {},
    },
    progress_done: 50,
    progress_total: 50,
    failed_count: 0,
    unscored_count: 0,
    degraded_count: 0,
    aggregate_metrics: { "recall@10": 0.9 },
    funnel: { stages: [], findings: [] },
    created_at: RUN_CREATED_AT,
    updated_at: "2026-07-19T12:04:00Z",
    completed_at: "2026-07-19T12:04:00Z",
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

export function makeEvalComparisonSide(
  overrides: Partial<EvalComparisonSide> = {},
): EvalComparisonSide {
  return {
    id: "run-1",
    name: "Dense baseline",
    dataset_id: "ds-1",
    dataset_name: "Synthetic set",
    ingestion_pipeline_id: "pipe-ing",
    ingestion_pipeline_name: "Standard ingest",
    retrieval_pipeline_id: "pipe-dense",
    retrieval_pipeline_name: "Dense search",
    status: "completed",
    failed_count: 0,
    unscored_count: 0,
    degraded_count: 0,
    scored_count: 50,
    created_at: RUN_CREATED_AT,
    ...overrides,
  };
}

export function makeEvalRunComparison(
  overrides: Partial<EvalRunComparison> = {},
): EvalRunComparison {
  return {
    run_a: makeEvalComparisonSide(),
    run_b: makeEvalComparisonSide({
      id: "run-2",
      name: "Hybrid candidate",
      retrieval_pipeline_id: "pipe-hybrid",
      retrieval_pipeline_name: "Hybrid search",
    }),
    metrics_comparable: true,
    caveats: [],
    differences: [
      {
        label: "Search tool",
        value_a: "Dense search",
        value_b: "Hybrid search",
        invalidates: false,
      },
    ],
    metrics: [
      { metric: "recall", k: 5, value_a: 0.4, value_b: 0.6, delta: 0.2 },
      { metric: "recall", k: 10, value_a: 0.5, value_b: 0.5, delta: 0 },
    ],
    headline_metric: "recall",
    headline_k: 10,
    queries: [
      {
        query_external_id: "q1",
        query_text: "capital of France",
        value_a: 1,
        value_b: 0,
        delta: -1,
        kind: "regressed",
        degraded_a: false,
        degraded_b: false,
      },
      {
        query_external_id: "q2",
        query_text: "largest ocean",
        value_a: 0,
        value_b: 1,
        delta: 1,
        kind: "improved",
        degraded_a: false,
        degraded_b: false,
      },
    ],
    funnel: [
      {
        node_id: "ingestion",
        label: "Indexed",
        node_type: "ingestion",
        retention_a: 0.8,
        retention_b: 0.9,
        delta: 0.1,
      },
    ],
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
    indexed_gold_doc_ids: ["docA"],
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
    degraded: false,
    error_message: null,
    ...overrides,
  };
}
