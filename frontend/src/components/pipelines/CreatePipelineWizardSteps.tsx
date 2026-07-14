"use client";

import { Sparkles } from "lucide-react";

import { EmbeddingModelSelectorCard } from "@/components/pipelines/EmbeddingModelSelectorCard";
import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { Field, TextInput } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { FlowStep } from "@/components/pipelines/flow/use-flow-playback";
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
    <div className="space-y-5">
      {kind === "ingestion" ? (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Chunking</p>
          <p className="mt-1 text-xs text-meta">
            Documents are split into chunks before embedding; chunk size trades precision for
            context.
          </p>
          <div
            className="mt-3 grid gap-2 sm:grid-cols-3"
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
                    "rounded-2xl border p-3 text-left transition",
                    active
                      ? "border-accent-violet/70 bg-accent-violet/10"
                      : "border-hairline bg-surface hover:border-strong",
                  )}
                >
                  <p className="text-sm font-semibold text-primary">{preset.label}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted">{preset.hint}</p>
                  <p className="mt-1.5 text-[10px] text-meta">
                    {preset.size} tokens · {preset.overlap} overlap
                  </p>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onToggleAdvancedChunking}
            aria-expanded={showAdvancedChunking}
            className="mt-3 text-xs text-muted underline-offset-2 hover:text-primary hover:underline"
          >
            {showAdvancedChunking ? "Hide advanced chunking" : "Advanced chunking"}
          </button>
          {showAdvancedChunking ? (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Chunk size (tokens)">
                <TextInput
                  type="number"
                  min={64}
                  value={chunkSize}
                  onChange={(event) => onChunkChange(Number(event.target.value) || 0, chunkOverlap)}
                />
              </Field>
              <Field label="Chunk overlap (tokens)">
                <TextInput
                  type="number"
                  min={0}
                  value={chunkOverlap}
                  onChange={(event) => onChunkChange(chunkSize, Number(event.target.value) || 0)}
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">
          Embedding model
        </p>
        <p className="mt-1 text-xs text-meta">
          {kind === "ingestion"
            ? "Turns each chunk into a vector. Leave the default unless you know you need a specific model."
            : "Must be the same model your ingestion pipeline used, so queries land in the same vector space."}
        </p>
        <div className="mt-3">
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
          <p className="mt-2 rounded-2xl border border-data-warn/40 bg-data-warn/10 px-3 py-2 text-xs text-data-warn">
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
  name: string;
  backend: IndexBackend;
  indexName: string;
  selectedModelName: string | null;
  chunkPresetLabel: string | null;
  chunkSize: number;
  chunkOverlap: number;
  preview: { nodes: Node<PipelineNodeData>[]; edges: TypedEdgeType[]; steps: FlowStep[] };
};

/** Animated preview of the pipeline being created, plus the summary card. */
export function WizardReviewStep({
  kind,
  name,
  backend,
  indexName,
  selectedModelName,
  chunkPresetLabel,
  chunkSize,
  chunkOverlap,
  preview,
}: ReviewStepProps) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-hairline bg-canvas-raised/70">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
          <Sparkles className="h-3.5 w-3.5 text-accent-cyan" />
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted">
            Your pipeline, in motion
          </p>
        </div>
        <div className="h-56">
          <FlowPlayer
            nodes={preview.nodes}
            edges={preview.edges}
            steps={preview.steps}
            autoPlay
            compact
            fitViewPadding={0.18}
          />
        </div>
      </div>
      <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-body">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.3em] text-meta">Name</dt>
            <dd className="mt-0.5 font-semibold text-primary">{name || "Untitled"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.3em] text-meta">Type</dt>
            <dd className="mt-0.5 text-primary">
              {kind === "ingestion" ? "Ingestion" : "Retrieval"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.3em] text-meta">Vector store</dt>
            <dd className="mt-0.5 text-primary">
              {BACKEND_TITLES[backend]} · {indexName || "no index"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.3em] text-meta">Embedding model</dt>
            <dd className="mt-0.5 text-primary">{selectedModelName ?? "Workspace default"}</dd>
          </div>
          {kind === "ingestion" ? (
            <div>
              <dt className="text-[10px] uppercase tracking-[0.3em] text-meta">Chunking</dt>
              <dd className="mt-0.5 text-primary">
                {chunkPresetLabel ? `${chunkPresetLabel} · ` : "Custom · "}
                {chunkSize}/{chunkOverlap} tokens
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
