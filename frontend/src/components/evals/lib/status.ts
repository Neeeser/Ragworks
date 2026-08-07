/**
 * Display state derived from the eval backends' status enums.
 *
 * One module so a run, a dataset, and an ingested corpus document all speak the
 * same vocabulary: a square node dot's tone, the sentence-case word beside it,
 * and whether a real process is still producing data. `live` is what licences
 * the pulse — nothing else may decide to animate.
 */

import type { StatusTone } from "@/components/ui/status-dot";
import type { EvalCollectionDocument, EvalDatasetStatus, EvalRunStatus } from "@/lib/types";

export interface DisplayStatus {
  tone: StatusTone;
  /** The backend word, humanised to sentence case. */
  label: string;
  /** True only while a process is actually moving data. */
  live: boolean;
}

/**
 * In-flight run phases are `active`, not `warn`: a run that is still ingesting
 * is not a run that needs attention.
 */
const RUN: Record<EvalRunStatus, DisplayStatus> = {
  pending: { tone: "active", label: "Pending", live: true },
  provisioning: { tone: "active", label: "Provisioning", live: true },
  ingesting: { tone: "active", label: "Ingesting", live: true },
  running: { tone: "active", label: "Running", live: true },
  completed: { tone: "pos", label: "Completed", live: false },
  failed: { tone: "neg", label: "Failed", live: false },
  cancelled: { tone: "neutral", label: "Cancelled", live: false },
};

export function runStatus(status: EvalRunStatus): DisplayStatus {
  return RUN[status];
}

/** What the run is doing right now, for the progress card's narration. */
export function runPhaseLabel(status: EvalRunStatus): string {
  switch (status) {
    case "running":
      return "Evaluating queries";
    case "ingesting":
      return "Ingesting corpus";
    case "provisioning":
      return "Provisioning collection";
    default:
      return "Preparing corpus";
  }
}

const DATASET: Record<EvalDatasetStatus, DisplayStatus> = {
  pending: { tone: "active", label: "Pending", live: true },
  downloading: { tone: "active", label: "Downloading", live: true },
  generating: { tone: "active", label: "Generating", live: true },
  ready: { tone: "pos", label: "Ready", live: false },
  failed: { tone: "neg", label: "Failed", live: false },
};

export function datasetStatus(status: EvalDatasetStatus): DisplayStatus {
  return DATASET[status];
}

/** What a dataset's `progress_done`/`progress_total` counters are counting. */
export interface DatasetProgressWords {
  /** Present participle for the pulse's accessible name. */
  verb: string;
  /** What the counters measure, in the plural. */
  unit: string;
}

/**
 * The words a dataset's progress counters are reported in, or null for a
 * status that produces none.
 *
 * Generation accepts questions while a benchmark import fetches corpus
 * documents, and both run for minutes — one mapping so the catalog row and the
 * dataset page never describe the same counters differently.
 */
export function datasetProgress(status: EvalDatasetStatus): DatasetProgressWords | null {
  switch (status) {
    case "generating":
      return { verb: "Generating", unit: "questions accepted" };
    case "downloading":
      return { verb: "Downloading", unit: "documents fetched" };
    default:
      return null;
  }
}

const DOCUMENT: Record<EvalCollectionDocument["status"], DisplayStatus> = {
  pending: { tone: "active", label: "Pending", live: true },
  processing: { tone: "active", label: "Processing", live: true },
  ready: { tone: "pos", label: "Ready", live: false },
  failed: { tone: "neg", label: "Failed", live: false },
};

export function documentStatus(status: EvalCollectionDocument["status"]): DisplayStatus {
  return DOCUMENT[status];
}

/** Where a dataset's corpus and judgments came from, in the console's voice. */
export const SOURCE_LABEL = {
  builtin_benchmark: "Benchmark",
  custom_upload: "Upload",
  synthetic: "Synthetic",
} as const;

/**
 * A benchmark collection's health, derived from its own counts — documents that
 * produced no chunks indexed nothing, which is the failure a user needs to see
 * without opening the collection.
 */
export function corpusHealth(numDocuments: number, numChunks: number): DisplayStatus {
  if (numDocuments === 0) return { tone: "neutral", label: "Empty", live: false };
  if (numChunks === 0) return { tone: "warn", label: "No chunks", live: false };
  return { tone: "pos", label: "Indexed", live: false };
}
