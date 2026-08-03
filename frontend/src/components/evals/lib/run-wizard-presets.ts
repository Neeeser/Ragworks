/** Run-size presets and the small value helpers the run wizard reads. */

import type { EvalDataset } from "@/lib/types";

export interface Preset {
  key: string;
  label: string;
  detail: string;
  queries: number | null; // null = all
  distractors: number | null;
}

export const PRESETS: Preset[] = [
  {
    key: "quick",
    label: "Quick",
    detail: "50 queries, 200 distractors",
    queries: 50,
    distractors: 200,
  },
  {
    key: "standard",
    label: "Standard",
    detail: "500 queries, 2,000 distractors",
    queries: 500,
    distractors: 2000,
  },
  {
    key: "full",
    label: "Full",
    detail: "every query, full corpus",
    queries: null,
    distractors: null,
  },
];

export const STEPS = [
  { id: "dataset", label: "Dataset", description: "What the pipelines are measured against." },
  {
    id: "pipelines",
    label: "Pipelines",
    description: "The ingestion and retrieval pair under test.",
  },
  { id: "scope", label: "Scope", description: "How much of the dataset the run covers." },
];

export function presetQueries(presetKey: string, dataset: EvalDataset | null): number {
  const preset = PRESETS.find((entry) => entry.key === presetKey) ?? PRESETS[0];
  return preset.queries ?? dataset?.num_queries ?? 0;
}

export function presetDistractors(presetKey: string, dataset: EvalDataset | null): number {
  const preset = PRESETS.find((entry) => entry.key === presetKey) ?? PRESETS[0];
  return preset.distractors ?? dataset?.num_corpus_docs ?? 0;
}

export function resolveCount(
  override: string,
  presetValue: number | null,
  datasetTotal: number,
): number {
  const parsed = Number(override);
  if (override !== "" && Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return presetValue ?? datasetTotal;
}
