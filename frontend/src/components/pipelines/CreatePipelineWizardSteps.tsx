"use client";

import { EmbeddingModelSelectorCard } from "@/components/pipelines/EmbeddingModelSelectorCard";
import { useResolvedEmbeddingDimension } from "@/components/pipelines/hooks/use-resolved-embedding-dimension";
import { PresetCard } from "@/components/pipelines/PresetCard";
import { RerankingModelSelectorCard } from "@/components/pipelines/RerankingModelSelectorCard";
import { WizardIntakePresets } from "@/components/pipelines/WizardIntakePresets";
import { ChunkWindowSummary } from "@/components/ui/chunk-window-summary";
import { Field, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import { catalogConnectionErrors } from "@/lib/model-catalog-cache";

import type { WizardModelChoice } from "@/components/pipelines/hooks/use-wizard-model-choice";
import type { IntakeMode } from "@/components/pipelines/lib/pipeline-scaffold";
import type { ModelAvailability } from "@/lib/model-catalog-cache";
import type {
  CatalogModel,
  ConnectionCatalogError,
  IndexBackend,
  ModelCatalogResponse,
  PipelineKind,
  VectorIndex,
} from "@/lib/types";

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
      "Runs on upload: reads the file with the parse nodes you choose, embeds what they produce, and writes it into the vector index.",
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
  /** Resolves the selected model's width when its catalog publishes none. */
  token: string;
  intake: IntakeMode;
  onIntakeChange: (mode: IntakeMode) => void;
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
  embeddingConnectionErrors: ConnectionCatalogError[];
  selectedIndex: VectorIndex | null;
  indexName: string;
  /** The model the index's ingestion pipeline embeds with, when one resolves. */
  indexEmbeddingModel: CatalogModel | null;
  /** The intake preset needs a capability the model states it lacks. */
  intakeConflict: string | null;
  /** The model states nothing about the capability the preset needs. */
  intakeCapabilityUnknown: string | null;
  onDismissCapabilityWarning: () => void;
};

/**
 * Whether two catalog entries name the same model on the same connection.
 * A model id alone repeats across connections.
 */
const sameModel = (a: CatalogModel | null, b: CatalogModel): boolean =>
  a !== null && a.id === b.id && a.connection_id === b.connection_id;

/** Intake and chunking presets (+ advanced overrides), and the embedding model picker. */
export function WizardProcessingStep({
  kind,
  token,
  intake,
  onIntakeChange,
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
  embeddingConnectionErrors,
  selectedIndex,
  indexName,
  indexEmbeddingModel,
  intakeConflict,
  intakeCapabilityUnknown,
  onDismissCapabilityWarning,
}: ProcessingStepProps) {
  const activePreset =
    CHUNK_PRESETS.find((preset) => preset.size === chunkSize && preset.overlap === chunkOverlap) ??
    null;
  const selectedModel =
    embeddingModels.find(
      (model) => model.id === embeddingModel && model.connection_id === embeddingConnectionId,
    ) ?? null;
  // The catalog publishes no width for most embedding models (OpenRouter
  // publishes none at all), so comparing the catalog value alone leaves this
  // warning silent for exactly the models it exists to catch. The resolved
  // width is the one already fetched for the picker's own readout — one
  // memoised lookup per (connection, model), not a probe per row.
  const selectedDimension = useResolvedEmbeddingDimension(
    token,
    embeddingConnectionId,
    embeddingModel || null,
    selectedModel?.dimension,
  );
  const dimensionMismatch =
    typeof selectedDimension === "number" &&
    typeof selectedIndex?.dimension === "number" &&
    selectedDimension !== selectedIndex.dimension;

  return (
    <div className="space-y-4">
      {kind === "ingestion" ? (
        <WizardIntakePresets value={intake} onChange={onIntakeChange} />
      ) : null}
      {/* Chunking splits text, so it only appears where the scaffold parses
          text — the image-only intake wires no chunker. */}
      {kind === "ingestion" && intake !== "images" ? (
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
            {CHUNK_PRESETS.map((preset) => (
              <PresetCard
                key={preset.id}
                label={preset.label}
                hint={preset.hint}
                detail={`${preset.size} tokens · ${preset.overlap} overlap`}
                detailClassName="tabular-nums"
                active={activePreset?.id === preset.id}
                onClick={() => onChunkChange(preset.size, preset.overlap)}
              />
            ))}
          </div>
          <ChunkWindowSummary
            chunkSize={chunkSize}
            chunkOverlap={chunkOverlap}
            unit="tokens"
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
              <Field label="Chunk size (tokens)">
                <TextInput
                  type="number"
                  min={64}
                  className="font-mono tabular-nums"
                  value={chunkSize}
                  onChange={(event) => onChunkChange(Number(event.target.value) || 0, chunkOverlap)}
                />
              </Field>
              <Field label="Chunk overlap (tokens)">
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
            connectionErrors={embeddingConnectionErrors}
            onSelectModel={onSelectEmbeddingModel}
            token={token}
            // Which model wrote this index, and which ones its width rules
            // out, are facts about the target — the catalog knows neither.
            annotate={(model) => {
              if (sameModel(indexEmbeddingModel, model)) {
                return { badge: "Wrote this index" };
              }
              if (
                typeof selectedIndex?.dimension === "number" &&
                typeof model.dimension === "number" &&
                model.dimension !== selectedIndex.dimension
              ) {
                return {
                  note: `${model.dimension.toLocaleString()}d — ${indexName} stores ${selectedIndex.dimension.toLocaleString()}d`,
                };
              }
              return null;
            }}
            prioritizedModelId={indexEmbeddingModel?.id ?? null}
          />
        </div>
        {intakeConflict ? (
          <p
            role="alert"
            className="mt-2 max-w-[66ch] rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2 text-ui text-data-neg"
          >
            {intakeConflict}
          </p>
        ) : null}
        {intakeCapabilityUnknown ? (
          <div
            role="status"
            className="mt-2 flex max-w-[66ch] items-start gap-3 rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2 text-ui text-data-warn"
          >
            <p className="min-w-0 flex-1">{intakeCapabilityUnknown}</p>
            <button
              type="button"
              onClick={onDismissCapabilityWarning}
              className="shrink-0 rounded-control text-instrument underline-offset-2 transition-colors duration-80 ease-standard hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {dimensionMismatch ? (
          <p className="mt-2 max-w-[66ch] rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2 text-ui text-data-warn">
            {selectedModel?.name ?? "This model"} produces {selectedDimension}-dimension vectors but
            the index &quot;{indexName}&quot; stores {selectedIndex?.dimension}. Pick a matching
            model or index.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The reranking catalog the wizard collects a model from, grouped as one prop. */
export type WizardRerankingCatalog = {
  models: CatalogModel[];
  catalog: ModelCatalogResponse | null;
  loading: boolean;
  error: string | null;
  onVisible: () => void;
  onRetry: () => void;
};

type RerankingStepProps = {
  catalog: WizardRerankingCatalog;
  choice: WizardModelChoice;
  availability: ModelAvailability;
  onSelectModel: (model: CatalogModel) => void;
};

/** The reranking model picker, collected like the embedding model. */
export function WizardRerankingStep({
  catalog,
  choice,
  availability,
  onSelectModel,
}: RerankingStepProps) {
  return (
    <div>
      <InstrumentLabel>Reranking model</InstrumentLabel>
      <p className="mt-0.5 max-w-[66ch] text-ui text-muted">
        Re-scores the over-fetched candidates against the query and reorders them before the result
        limit trims back.
      </p>
      <div className="mt-2">
        <RerankingModelSelectorCard
          models={catalog.models}
          selectedModelKey={choice.modelId}
          selectedConnectionId={choice.connectionId}
          selectedConnectionLabel={choice.connectionLabel}
          selectedAvailability={availability}
          onSelectModel={onSelectModel}
          onRetry={catalog.onRetry}
          modelsLoading={catalog.loading}
          modelsError={catalog.error}
          connectionErrors={catalogConnectionErrors(catalog.catalog)}
        />
      </div>
    </div>
  );
}
