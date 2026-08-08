/** Run-size presets and the small value helpers the run wizard reads. */

import type { EvalDataset } from "@/lib/types";

export interface Preset {
  key: string;
  label: string;
  queries: number | null; // null = all
  distractors: number | null;
}

export const PRESETS: Preset[] = [
  { key: "quick", label: "Quick", queries: 50, distractors: 200 },
  { key: "standard", label: "Standard", queries: 500, distractors: 2000 },
  { key: "full", label: "Full", queries: null, distractors: null },
];

/** Pluralise a count against its own noun, so "1 query" never reads as "1 queries". */
function countLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

/**
 * What this preset covers of the dataset in hand.
 *
 * A preset's numbers are ceilings, not promises: "50 queries, 200 distractors"
 * printed against a three-query dataset describes a run that cannot happen, and
 * the result then reports "3 evaluated" — which reads as a broken run rather
 * than a dataset smaller than the ceiling. Both figures are clamped to what the
 * dataset actually holds. With no dataset loaded there is nothing to clamp
 * against, so the ceiling stands on its own.
 */
export function presetDetail(preset: Preset, dataset: EvalDataset | null): string {
  const queries =
    dataset === null ? preset.queries : Math.min(preset.queries ?? Infinity, dataset.num_queries);
  const distractors =
    dataset === null
      ? preset.distractors
      : Math.min(preset.distractors ?? Infinity, dataset.num_corpus_docs);
  if (queries === null || distractors === null) return "every query, full corpus";
  const queryPart = countLabel(queries, "query", "queries");
  return `${queryPart}, ${countLabel(distractors, "distractor", "distractors")}`;
}

export const STEPS = [
  { id: "dataset", label: "Dataset", description: "What the pipelines are measured against." },
  {
    id: "pipelines",
    label: "Pipelines",
    description: "The ingestion pipeline and search tool under test.",
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

/**
 * The count this run records, clamped to what the dataset can supply.
 *
 * Both the preset ceiling and an explicit override are requests, not
 * guarantees: sampling caps them at what exists, so storing the larger number
 * leaves the run's own header describing a scope its results contradict —
 * "50 queries" beside "3 evaluated" reads as a failure rather than a dataset
 * smaller than the preset.
 */
export function resolveCount(
  override: string,
  presetValue: number | null,
  datasetTotal: number,
): number {
  const parsed = Number(override);
  const requested =
    override !== "" && Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : (presetValue ?? datasetTotal);
  return Math.min(requested, datasetTotal);
}
