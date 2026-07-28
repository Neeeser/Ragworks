"use client";

import { EmbeddingModelSelectorCard } from "@/components/pipelines/EmbeddingModelSelectorCard";
import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { ChunkWindowSummary } from "@/components/ui/chunk-window-summary";
import { Field, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { FlowStep } from "@/components/pipelines/lib/pipeline-playback";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { CatalogModel, IndexBackend, PipelineKind, VectorIndex } from "@/lib/types";
import type { Node } from "@xyflow/react";

export type ChunkPreset = {
  id: string;
  label: string;
  hint: string;
  size: number;
  overlap: number;
};

export const KIND_COPY: Record<
  PipelineKind,
  { headline: string; explainer: string; namePlaceholder: string }
> = {
  ingestion: {
    headline: "New ingestion pipeline",
    explainer:
      "Runs on upload: parses the document, splits it into chunks, embeds each chunk, and writes them into the vector index.",
    namePlaceholder: "e.g. Research library ingestion",
  },
  retrieval: {
    headline: "New tool pipeline",
    explainer:
      "Runs on search and chat: embeds the question and reads the closest matching chunks out of the vector index.",
    namePlaceholder: "e.g. Research library retrieval",
  },
};

export const CHUNK_PRESETS: ChunkPreset[] = [
  { id: "fine", label: "Fine", hint: "Short chunks, precise matches", size: 512, overlap: 64 },
  {
    id: "balanced",
    label: "Balanced",
    hint: "Good default for most documents",
    size: 1024,
    overlap: 200,
  },
  { id: "broad", label: "Broad", hint: "Long chunks, more context each", size: 2048, overlap: 256 },
];

export const BACKEND_TITLES: Record<IndexBackend, string> = {
  pgvector: "pgvector (PostgreSQL)",
  pinecone: "Pinecone",
};

type ProcessingStepProps = {
  kind: PipelineKind;
  chunkSize: number;
  chunkOverlap: number;
  onChunkChange: (size: number, overlap: number) => void;
  showAdvancedChunking: boolean;
  onToggleAdvancedChunking: () => void;
  embeddingModel: string;
  embeddingConnectionId: string | null;
  embeddingConnectionLabel?: string | null;
  selectedAvailability: "available" | "unknown" | "missing";
  onSelectEmbeddingModel: (model: CatalogModel) => void;
  embeddingModels: CatalogModel[];
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  selectedIndex: VectorIndex | null;
  indexName: string;
};

/** Chunking presets (+ advanced overrides) and the embedding model picker. */
export function WizardProcessingStep({
  kind,
  chunkSize,
  chunkOverlap,
  onChunkChange,
  showAdvancedChunking,
  onToggleAdvancedChunking,
  embeddingModel,
  embeddingConnectionId,
  embeddingConnectionLabel,
  selectedAvailability,
  onSelectEmbeddingModel,
  embeddingModels,
  embeddingModelsLoading,
  embeddingModelsError,
  selectedIndex,
  indexName,
}: ProcessingStepProps) {
  const activePreset =
    CHUNK_PRESETS.find((preset) => preset.size === chunkSize && preset.overlap === chunkOverlap) ??
    null;
  const selectedModel =
    embeddingModels.find(
      (model) => model.id === embeddingModel && model.connection_id === embeddingConnectionId,
    ) ?? null;
  const dimensionMismatch =
    typeof selectedModel?.dimension === "number" &&
    typeof selectedIndex?.dimension === "number" &&
    selectedModel.dimension !== selectedIndex.dimension;

  return (
    <div className="space-y-4">
      {kind === "ingestion" ? (
        <div>
          <InstrumentLabel>Chunking</InstrumentLabel>
          <p className="mt-0.5 max-w-[66ch] text-ui text-muted">
            Documents are split into chunks before embedding; chunk size trades precision for
            context.
          </p>
          <div
            className="mt-2 grid gap-2 sm:grid-cols-3"
            role="radiogroup"
            aria-label="Chunking preset"
          >
            {CHUNK_PRESETS.map((preset) => {
              const active = activePreset?.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChunkChange(preset.size, preset.overlap)}
                  className={cn(
                    "rounded-control border p-3 text-left transition-colors duration-80 ease-standard",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
                    active
                      ? "border-accent-violet/70 bg-accent-violet/10"
                      : "border-hairline bg-surface hover:border-strong",
                  )}
                >
                  <p className="text-ui font-medium text-primary">{preset.label}</p>
                  <p className="mt-0.5 text-instrument leading-4 text-muted">{preset.hint}</p>
                  <p className="mt-1 font-mono text-instrument tabular-nums text-meta">
                    {preset.size} words · {preset.overlap} overlap
                  </p>
                </button>
              );
            })}
          </div>
          <ChunkWindowSummary
            chunkSize={chunkSize}
            chunkOverlap={chunkOverlap}
            unit="words"
            className="mt-2"
          />
          <button
            type="button"
            onClick={onToggleAdvancedChunking}
            aria-expanded={showAdvancedChunking}
            className="mt-2 rounded-control text-ui text-muted underline-offset-2 transition-colors duration-80 ease-standard hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          >
            {showAdvancedChunking ? "Hide advanced chunking" : "Advanced chunking"}
          </button>
          {showAdvancedChunking ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="Chunk size (words)">
                <TextInput
                  type="number"
                  min={64}
                  className="font-mono tabular-nums"
                  value={chunkSize}
                  onChange={(event) => onChunkChange(Number(event.target.value) || 0, chunkOverlap)}
                />
              </Field>
              <Field label="Chunk overlap (words)">
                <TextInput
                  type="number"
                  min={0}
                  className="font-mono tabular-nums"
                  value={chunkOverlap}
                  onChange={(event) => onChunkChange(chunkSize, Number(event.target.value) || 0)}
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}
      <div>
        <InstrumentLabel>Embedding model</InstrumentLabel>
        <p className="mt-0.5 max-w-[66ch] text-ui text-muted">
          {kind === "ingestion"
            ? "Turns each chunk into a vector."
            : "Must be the same model your ingestion pipeline used, so queries land in the same vector space."}
        </p>
        <div className="mt-2">
          <EmbeddingModelSelectorCard
            models={embeddingModels}
            selectedModelKey={embeddingModel}
            selectedConnectionId={embeddingConnectionId}
            selectedConnectionLabel={embeddingConnectionLabel}
            selectedAvailability={selectedAvailability}
            modelsLoading={embeddingModelsLoading}
            modelsError={embeddingModelsError}
            onSelectModel={onSelectEmbeddingModel}
          />
        </div>
        {dimensionMismatch ? (
          <p className="mt-2 max-w-[66ch] rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2 text-ui text-data-warn">
            {selectedModel?.name ?? "This model"} produces {selectedModel?.dimension}-dimension
            vectors but the index &quot;{indexName}&quot; stores {selectedIndex?.dimension}. Pick a
            matching model or index.
          </p>
        ) : null}
      </div>
    </div>
  );
}

type ReviewStepProps = {
  kind: PipelineKind;
  /** What to show in the "Type" row (the template label for tool pipelines). */
  typeLabel: string;
  name: string;
  backend: IndexBackend;
  indexName: string;
  /** Whether this pipeline points at an index — the blank scaffold doesn't. */
  showStore: boolean;
  /** Whether this pipeline embeds — count/facet tools don't, so hide the row. */
  showEmbedding: boolean;
  selectedModelName: string | null;
  chunkPresetLabel: string | null;
  chunkSize: number;
  chunkOverlap: number;
  preview: { nodes: Node<PipelineNodeData>[]; edges: TypedEdgeType[]; steps: FlowStep[] };
};

/** Animated preview of the pipeline being created, plus the summary card. */
export function WizardReviewStep({
  kind,
  typeLabel,
  name,
  backend,
  indexName,
  showStore,
  showEmbedding,
  selectedModelName,
  chunkPresetLabel,
  chunkSize,
  chunkOverlap,
  preview,
}: ReviewStepProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div className="space-y-3">
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
        {kind === "ingestion" ? (
          <div className="min-w-0">
            <dt>
              <InstrumentLabel>Chunking</InstrumentLabel>
            </dt>
            <dd className="mt-0.5 truncate text-ui text-primary">
              {chunkPresetLabel ? `${chunkPresetLabel} · ` : "Custom · "}
              <span className="font-mono tabular-nums">
                {chunkSize}/{chunkOverlap}
              </span>{" "}
              words
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
