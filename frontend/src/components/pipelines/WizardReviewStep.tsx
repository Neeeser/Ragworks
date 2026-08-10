"use client";

import { BACKEND_TITLES } from "@/components/pipelines/CreatePipelineWizardSteps";
import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { ValidationBlockerList } from "@/components/pipelines/ValidationBlockerList";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { FlowStep } from "@/components/pipelines/lib/pipeline-playback";
import type { SaveBlockerGroup } from "@/components/pipelines/lib/save-blockers";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { IndexBackend, PipelineKind } from "@/lib/types";
import type { Node } from "@xyflow/react";

type ReviewStepProps = {
  kind: PipelineKind;
  /** What to show in the "Type" row (the template label for tool pipelines). */
  typeLabel: string;
  name: string;
  backend: IndexBackend;
  indexName: string;
  /** Whether this pipeline points at an index — the blank scaffold doesn't. */
  showStore: boolean;
  /** True when the store row names an index the wizard is about to create. */
  indexIsNew: boolean;
  /** The BM25 sibling created with a new index, or "" where none is. */
  bm25IndexName: string;
  /** Whether this pipeline embeds — count/facet tools don't, so hide the row. */
  showEmbedding: boolean;
  selectedModelName: string | null;
  /** Whether this pipeline reranks — only the reranked template does. */
  showReranking: boolean;
  rerankingModelName: string | null;
  /** Whether this pipeline describes images — only the described intake does. */
  showVision: boolean;
  visionModelName: string | null;
  /** The intake preset's label, or null for a pipeline that parses nothing. */
  intakeLabel: string | null;
  /** Whether the scaffold chunks — the image-only intake wires no chunker. */
  showChunking: boolean;
  chunkPresetLabel: string | null;
  chunkSize: number;
  chunkOverlap: number;
  preview: { nodes: Node<PipelineNodeData>[]; edges: TypedEdgeType[]; steps: FlowStep[] };
  /** Why the last create attempt was refused, grouped by the node each
   * finding names — the same nodes the graph above draws. */
  blockers: SaveBlockerGroup[];
};

/** Animated preview of the pipeline being created, plus the summary card. */
export function WizardReviewStep({
  kind,
  typeLabel,
  name,
  backend,
  indexName,
  showStore,
  indexIsNew,
  bm25IndexName,
  showEmbedding,
  selectedModelName,
  showReranking,
  rerankingModelName,
  showVision,
  visionModelName,
  intakeLabel,
  showChunking,
  chunkPresetLabel,
  chunkSize,
  chunkOverlap,
  preview,
  blockers,
}: ReviewStepProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div className="space-y-3">
      <ValidationBlockerList groups={blockers} caption="Fix these before creating:" />
      {/* The graph is the review: it shows every node the scaffold will create,
          which no summary line can. It carries no caption of its own. */}
      <div className="h-56 overflow-hidden rounded-control border border-hairline">
        <FlowPlayer
          nodes={preview.nodes}
          edges={preview.edges}
          steps={preview.steps}
          autoPlay={!prefersReducedMotion}
          compact
          fitViewPadding={0.18}
        />
      </div>
      <dl className="grid gap-3 rounded-control border border-hairline bg-surface p-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt>
            <InstrumentLabel>Name</InstrumentLabel>
          </dt>
          <dd className="mt-0.5 truncate text-ui font-medium text-primary">{name || "Untitled"}</dd>
        </div>
        <div className="min-w-0">
          <dt>
            <InstrumentLabel>Type</InstrumentLabel>
          </dt>
          <dd className="mt-0.5 truncate text-ui text-primary">{typeLabel}</dd>
        </div>
        {showStore ? (
          <div className="min-w-0">
            <dt>
              <InstrumentLabel>Vector store</InstrumentLabel>
            </dt>
            <dd className="mt-0.5 truncate text-ui text-primary">
              {BACKEND_TITLES[backend]} ·{" "}
              <span className="font-mono">{indexName || "no index"}</span>
              {indexIsNew ? (
                <span className="text-meta">
                  {" "}
                  · new{bm25IndexName ? ` + ${bm25IndexName}` : ""}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {showEmbedding ? (
          <div className="min-w-0">
            <dt>
              <InstrumentLabel>Embedding model</InstrumentLabel>
            </dt>
            <dd className="mt-0.5 truncate text-ui text-primary">
              {selectedModelName ?? "Workspace default"}
            </dd>
          </div>
        ) : null}
        {showReranking ? (
          <div className="min-w-0">
            <dt>
              <InstrumentLabel>Reranking model</InstrumentLabel>
            </dt>
            <dd className="mt-0.5 truncate text-ui text-primary">
              {rerankingModelName ?? "Not selected"}
            </dd>
          </div>
        ) : null}
        {showVision ? (
          <div className="min-w-0">
            <dt>
              <InstrumentLabel>Vision model</InstrumentLabel>
            </dt>
            <dd className="mt-0.5 truncate text-ui text-primary">
              {visionModelName ?? "Not selected"}
            </dd>
          </div>
        ) : null}
        {intakeLabel ? (
          <div className="min-w-0">
            <dt>
              <InstrumentLabel>Intake</InstrumentLabel>
            </dt>
            <dd className="mt-0.5 truncate text-ui text-primary">{intakeLabel}</dd>
          </div>
        ) : null}
        {kind === "ingestion" && showChunking ? (
          <div className="min-w-0">
            <dt>
              <InstrumentLabel>Chunking</InstrumentLabel>
            </dt>
            <dd className="mt-0.5 truncate text-ui text-primary">
              {chunkPresetLabel ? `${chunkPresetLabel} · ` : "Custom · "}
              <span className="font-mono tabular-nums">
                {chunkSize}/{chunkOverlap}
              </span>{" "}
              tokens
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
