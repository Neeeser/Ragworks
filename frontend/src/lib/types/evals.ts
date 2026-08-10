/** Eval wire types, hand-mirrored from `app/schemas/evals.py`. */

import type { MediaAssetRef } from "@/lib/types/collections";
import type { UUID } from "@/lib/types/common";

export type EvalDatasetSource = "builtin_benchmark" | "custom_upload" | "synthetic";

export type EvalDatasetStatus = "pending" | "downloading" | "generating" | "ready" | "failed";

/** Mirrors `EvalModality` — what a dataset record's content actually is. */
export type EvalModality = "text" | "image";

export type EvalQuestionType = "single_fact" | "paraphrased" | "multi_detail";

export type RelevanceGranularity = "document" | "chunk";

export type EvalRunStatus =
  | "pending"
  | "provisioning"
  | "ingesting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type EvalFindingSeverity = "info" | "warning" | "critical";

/** Mirrors `BuiltinDatasetInfo` — a curated benchmark before import.
 * `license_name` and `approx_download_mb` are what a user weighs before
 * starting an import that may run for minutes. */
export interface BuiltinDatasetInfo {
  key: string;
  name: string;
  description: string;
  domain: string;
  measures: string;
  num_queries: number;
  num_corpus_docs: number;
  modalities: EvalModality[];
  license_name: string;
  approx_download_mb: number;
}

/** Mirrors `EvalDatasetRead`. Progress fields count accepted questions while
 * a synthetic dataset is `generating` and fetched corpus documents while a
 * benchmark is `downloading`; zero/null on other sources. */
export interface EvalDataset {
  id: UUID;
  name: string;
  description?: string | null;
  source: EvalDatasetSource;
  source_ref?: string | null;
  relevance_granularity: RelevanceGranularity;
  status: EvalDatasetStatus;
  error_message?: string | null;
  num_queries: number;
  num_corpus_docs: number;
  /** What the dataset's records carry, without loading its corpus. */
  modalities: EvalModality[];
  progress_done: number;
  progress_total: number;
  generation_config?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Mirrors `EvalMetricInfo` — a registered metric plus its tooltip text. */
export interface EvalMetricInfo {
  name: string;
  label: string;
  description: string;
  is_rank_aware: boolean;
}

/** Mirrors `EvalRunConfig`. */
export interface EvalRunConfig {
  num_queries: number;
  distractor_pool_size: number;
  seed: number;
  concurrency: number;
  k_values: number[];
  selected_metrics: string[];
  run_inputs: Record<string, unknown>;
}

/** Mirrors `EvalRunCreate`. */
export interface EvalRunCreatePayload {
  dataset_id: UUID;
  ingestion_pipeline_id: UUID;
  retrieval_pipeline_id: UUID;
  name?: string | null;
  config: EvalRunConfig;
}

/** Mirrors `PromptComparisonRequest` — A/B two versions of one prompt. */
export interface PromptComparisonPayload {
  prompt_id: UUID;
  version_a: number;
  version_b: number;
  dataset_id: UUID;
  ingestion_pipeline_id: UUID;
  retrieval_pipeline_id: UUID;
  config: EvalRunConfig;
}

/** Mirrors `FunnelStage` — aggregate gold retention at one pipeline node. */
export interface FunnelStage {
  node_id: string;
  node_type: string;
  label: string;
  gold_retained: number;
  gold_total: number;
  retention: number;
}

/** Mirrors `EvalFinding` — a node-addressed recommendation. */
export interface EvalFinding {
  node_id: string;
  label: string;
  severity: EvalFindingSeverity;
  category: string;
  message: string;
}

/** Mirrors `FunnelSummary`. */
export interface FunnelSummary {
  stages: FunnelStage[];
  findings: EvalFinding[];
}

/** Mirrors `EvalRetrievedChunk` — one retrieved chunk, in rank order. */
export interface EvalRetrievedChunk {
  chunk_id?: string | null;
  document_id: string;
  score?: number | null;
  /** The stored image this result stands for, when it has one — an image
   * result is what an image-retrieval run is judged on. */
  media?: MediaAssetRef | null;
}

/**
 * Mirrors `EvalItemNodeDocs` — the documents one node emitted for one query.
 * `node_id` matches the run-level funnel stages (including `"ingestion"`).
 */
export interface EvalItemNodeDocs {
  node_id: string;
  document_ids: string[];
}

/** Mirrors `EvalRunItemRead` — one evaluated query. */
export interface EvalRunItem {
  id: UUID;
  query_external_id: string;
  query_text: string;
  /** The dataset query's stored image, resolved at read time from the dataset.
   * An image query has no text, so without it the row renders blank. */
  query_media?: MediaAssetRef | null;
  pipeline_run_id?: UUID | null;
  query_event_id?: UUID | null;
  result_count: number;
  gold_doc_ids: string[];
  /**
   * The subset of `gold_doc_ids` that reached the index. Fewer means the query
   * was scored against partial evidence; empty (with gold present) means it was
   * excluded from the run's aggregate entirely.
   */
  indexed_gold_doc_ids: string[];
  retrieved_document_ids: string[];
  retrieved: EvalRetrievedChunk[];
  per_node_funnel: EvalItemNodeDocs[];
  metrics: Record<string, number>;
  failed: boolean;
  /**
   * A node in this query's retrieval run passed its input through after a
   * provider failure — the metrics beside it describe a pipeline that partly
   * did not run.
   */
  degraded: boolean;
  error_message?: string | null;
}

/** Mirrors `EvalRunItemsResponse` — items plus document display titles. */
export interface EvalRunItemsResponse {
  items: EvalRunItem[];
  document_titles: Record<string, string>;
}

/** Mirrors `EvalRunCoverage` — read-time dataset coverage for a run. */
export interface EvalRunCoverage {
  corpus_ingested: number;
  corpus_total: number;
  /**
   * Documents materialized in the eval collection that did not reach the
   * index — what a corpus retry would repair, and zero once it has.
   */
  corpus_unindexed: number;
  queries_done: number;
  queries_total: number;
}

/** Mirrors `EvalRunRead`. */
export interface EvalRun {
  id: UUID;
  name?: string | null;
  dataset_id: UUID;
  eval_collection_id?: UUID | null;
  ingestion_pipeline_id: UUID;
  retrieval_pipeline_id: UUID;
  status: EvalRunStatus;
  config: EvalRunConfig;
  progress_done: number;
  progress_total: number;
  failed_count: number;
  unscored_count: number;
  /** Queries scored on a run whose retrieval held a degraded node. */
  degraded_count: number;
  coverage?: EvalRunCoverage | null;
  aggregate_metrics: Record<string, number>;
  funnel: FunnelSummary;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

/** Mirrors `EvalRunSummary` — the list-view row. */
export interface EvalRunSummary {
  id: UUID;
  name?: string | null;
  dataset_id: UUID;
  status: EvalRunStatus;
  progress_done: number;
  progress_total: number;
  failed_count: number;
  unscored_count: number;
  /** Queries scored on a run whose retrieval held a degraded node. */
  degraded_count: number;
  coverage?: EvalRunCoverage | null;
  aggregate_metrics: Record<string, number>;
  created_at: string;
}

/** Mirrors `EvalCollectionRead` — a provisioned benchmark collection. */
export interface EvalCollection {
  id: UUID;
  name: string;
  dataset_id?: UUID | null;
  ingestion_pipeline_id?: UUID | null;
  num_documents: number;
  num_indexed_documents: number;
  num_chunks: number;
  created_at: string;
  updated_at: string;
}

/** Mirrors `EvalCollectionDocument` — one ingested corpus document. */
export interface EvalCollectionDocument {
  document_id: UUID;
  external_doc_id: string;
  title?: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  error_message?: string | null;
  num_chunks: number;
}

/** Mirrors `EvalCollectionDocumentsPage`. */
export interface EvalCollectionDocumentsPage {
  total: number;
  items: EvalCollectionDocument[];
}

/** Mirrors `EvalDatasetDocumentRead` — a corpus document's stored source. A
 * page-image document carries `media` and no text; a document may carry both. */
export interface EvalDatasetDocument {
  external_doc_id: string;
  title?: string | null;
  text?: string | null;
  media?: MediaAssetRef | null;
}

/** Request body for `POST /api/evals/datasets/upload`. */
export interface EvalDatasetUploadPayload {
  name: string;
  description?: string | null;
  corpus: string;
  queries: string;
  qrels: string;
}

/** Mirrors `GenerationModelChoice` — one modality's generation model. */
export interface GenerationModelChoice {
  connection_id: UUID;
  model_name: string;
}

/** Mirrors `EvalDatasetGenerateRequest` (`app/schemas/evals_generation.py`).
 * `models` must carry a `text` entry: every dataset produces text questions. */
export interface EvalDatasetGeneratePayload {
  name: string;
  description?: string | null;
  collection_id: UUID;
  models: Record<EvalModality, GenerationModelChoice>;
  num_questions: number;
  type_mix?: Partial<Record<EvalQuestionType, number>>;
  audience?: string | null;
  example_queries?: string[];
  seed?: number;
}

/** Mirrors `EvalDatasetQueryGold` — one gold document reference on a query. */
export interface EvalDatasetQueryGold {
  external_doc_id: string;
  title?: string | null;
}

/** Mirrors `EvalDatasetQueryRead` — one query in the review table. The
 * metadata fields are populated for synthetic queries only; an image query
 * asks with a picture and carries no text. */
export interface EvalDatasetQuery {
  id: UUID;
  external_query_id: string;
  text?: string | null;
  media?: MediaAssetRef | null;
  question_type?: EvalQuestionType | null;
  scores?: Record<string, number> | null;
  quote?: string | null;
  gold: EvalDatasetQueryGold[];
}

/** Mirrors `EvalDatasetQueriesPage`. */
export interface EvalDatasetQueriesPage {
  total: number;
  items: EvalDatasetQuery[];
}

/** Mirrors `EvalComparisonCaveatCode` — why two runs' metrics do not compare. */
export type EvalComparisonCaveatCode =
  | "different_datasets"
  | "degraded_run"
  | "unfinished_run"
  | "disjoint_queries"
  | "no_shared_metric";

/** Mirrors `EvalQueryDeltaKind` — how one query's score moved. `unscored` is a
 * query both runs evaluated where at least one produced no score for the metric
 * under comparison; `only_a`/`only_b` mean the other run never saw it. */
export type EvalQueryDeltaKind =
  | "improved"
  | "regressed"
  | "unchanged"
  | "unscored"
  | "only_a"
  | "only_b";

/** Mirrors `EvalComparisonSide` — one run's identity and qualifying counts. */
export interface EvalComparisonSide {
  id: UUID;
  name?: string | null;
  dataset_id: UUID;
  dataset_name?: string | null;
  ingestion_pipeline_id: UUID;
  ingestion_pipeline_name?: string | null;
  retrieval_pipeline_id: UUID;
  retrieval_pipeline_name?: string | null;
  status: EvalRunStatus;
  failed_count: number;
  unscored_count: number;
  degraded_count: number;
  scored_count: number;
  created_at: string;
}

/** Mirrors `EvalConfigDifference` — one field the two runs disagree on. */
export interface EvalConfigDifference {
  label: string;
  value_a: string;
  value_b: string;
  /** A difference that makes the metric comparison meaningless, not just notable. */
  invalidates: boolean;
}

/** Mirrors `EvalComparisonCaveat`. */
export interface EvalComparisonCaveat {
  code: EvalComparisonCaveatCode;
  message: string;
}

/** Mirrors `EvalMetricDelta` — one metric at one cutoff on both sides.
 * `delta` is `value_b - value_a`, null when either side never computed it. */
export interface EvalMetricDelta {
  metric: string;
  k: number;
  value_a?: number | null;
  value_b?: number | null;
  delta?: number | null;
}

/** Mirrors `EvalQueryDelta` — one query's headline score on both sides. */
export interface EvalQueryDelta {
  query_external_id: string;
  query_text: string;
  /** The query's stored image, for a query that asked with a picture. */
  query_media?: MediaAssetRef | null;
  value_a?: number | null;
  value_b?: number | null;
  delta?: number | null;
  kind: EvalQueryDeltaKind;
  degraded_a: boolean;
  degraded_b: boolean;
}

/** Mirrors `EvalFunnelStageDelta` — gold retention at one node on both sides. */
export interface EvalFunnelStageDelta {
  node_id: string;
  label: string;
  node_type: string;
  retention_a?: number | null;
  retention_b?: number | null;
  delta?: number | null;
}

/** Mirrors `EvalRunComparison` — two runs side by side with their deltas. */
export interface EvalRunComparison {
  run_a: EvalComparisonSide;
  run_b: EvalComparisonSide;
  /** False when a caveat invalidates the comparison; the deltas are still present. */
  metrics_comparable: boolean;
  caveats: EvalComparisonCaveat[];
  differences: EvalConfigDifference[];
  metrics: EvalMetricDelta[];
  headline_metric?: string | null;
  headline_k?: number | null;
  queries: EvalQueryDelta[];
  funnel: EvalFunnelStageDelta[];
}
