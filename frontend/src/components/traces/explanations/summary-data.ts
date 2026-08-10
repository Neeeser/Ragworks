import {
  isEmbeddingPreview,
  isEmbeddingSummary,
  isFileSummary,
  isImageSummary,
  isItemListTrace,
  isMatchList,
  isMediaAssetRef,
  isParsedTextSummary,
  isRankingEvidence,
  isTextSummary,
} from "@/components/traces/values/shape-guards";

import type { TraceStep } from "@/components/traces/trace-graph";
import type {
  EmbeddingPreviewShape,
  EmbeddingSummaryShape,
  FileSummaryShape,
  ImageSummaryShape,
  MatchListShape,
  MediaAssetRefShape,
  ParsedTextSummaryShape,
  TextSummaryShape,
} from "@/components/traces/values/shape-guards";
import type { ItemListTrace, PipelineNodeSummaryValue, RankingEvidence } from "@/lib/types";

export type LocatedItemList = { label: string; list: ItemListTrace };

const values = (step: TraceStep, side: "inputs" | "outputs"): PipelineNodeSummaryValue[] =>
  step.run?.summary[side] ?? [];

export const itemLists = (step: TraceStep, side: "inputs" | "outputs"): LocatedItemList[] =>
  values(step, side).flatMap((value) =>
    value.kind === "items" && isItemListTrace(value.value)
      ? [{ label: value.label, list: value.value }]
      : [],
  );

const findShape = <T>(
  entries: PipelineNodeSummaryValue[],
  guard: (value: unknown) => value is T,
): T | null => entries.find((entry) => guard(entry.value))?.value as T | null;

export const fileSummary = (step: TraceStep, side: "inputs" | "outputs"): FileSummaryShape | null =>
  findShape(values(step, side), isFileSummary);

export const textSummary = (step: TraceStep, side: "inputs" | "outputs"): TextSummaryShape | null =>
  findShape(values(step, side), isTextSummary);

export const imageSummary = (
  step: TraceStep,
  side: "inputs" | "outputs",
): ImageSummaryShape | null => findShape(values(step, side), isImageSummary);

/** What a text parse node emitted, including the produced-nothing case. */
export const parsedTextSummary = (step: TraceStep): ParsedTextSummaryShape | null =>
  findShape(values(step, "outputs"), isParsedTextSummary);

/** A stored media reference the node carried (an image query's picture). */
export const mediaAsset = (
  step: TraceStep,
  side: "inputs" | "outputs",
): MediaAssetRefShape | null => findShape(values(step, side), isMediaAssetRef);

export const matchSummary = (step: TraceStep, side: "inputs" | "outputs"): MatchListShape | null =>
  findShape(values(step, side), isMatchList);

export const rankingSummary = (
  step: TraceStep,
  side: "inputs" | "outputs",
): RankingEvidence | null => findShape(values(step, side), isRankingEvidence);

export const embeddingSummary = (
  step: TraceStep,
  side: "inputs" | "outputs",
): EmbeddingSummaryShape | EmbeddingPreviewShape | null => {
  const entries = values(step, side);
  return findShape(entries, isEmbeddingSummary) ?? findShape(entries, isEmbeddingPreview) ?? null;
};

export const summaryValue = (step: TraceStep, label: string): unknown => {
  const all = [...values(step, "inputs"), ...values(step, "outputs")];
  return all.find((entry) => entry.label === label)?.value;
};

export const previewTextById = (summary: MatchListShape | null): Map<string, string> =>
  new Map(summary?.top_matches.map((match) => [match.chunk_id, match.preview]) ?? []);

/** Flatten common Markdown syntax so compact result previews read as prose. */
export const formatTracePreview = (value: string): string =>
  value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/~~/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
