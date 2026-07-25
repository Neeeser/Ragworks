"use client";

import {
  EMBEDDING_MODEL_SORTS,
  useModelCatalogFilter,
} from "@/components/models/model-catalog-filter";
import { ModelCatalogPicker } from "@/components/models/ModelCatalogPicker";
import { ModelOptionButton } from "@/components/models/ModelOptionButton";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";
import { formatPricePerMillion } from "@/lib/format";

import type { CatalogModel } from "@/lib/types";

/** One embedding-model row: connection-qualified subtitle plus context, dimension, and pricing badges. */
function EmbeddingModelRow({
  model,
  selectedModelKey,
  selectedConnectionId,
  onSelectModel,
}: {
  model: CatalogModel;
  selectedModelKey: string;
  selectedConnectionId?: string | null;
  onSelectModel: (model: CatalogModel) => void;
}) {
  const selected =
    Boolean(selectedModelKey) &&
    model.id === selectedModelKey &&
    model.connection_id === selectedConnectionId;
  const contextLabel = model.context_length
    ? Math.round(model.context_length).toLocaleString()
    : null;
  const dimensionLabel = model.dimension ? model.dimension.toLocaleString() : null;
  const promptLabel = formatPricePerMillion(model.pricing?.prompt);
  const completionLabel = formatPricePerMillion(model.pricing?.completion);
  const description =
    model.description && model.description.length > 160
      ? `${model.description.slice(0, 157)}...`
      : model.description;
  return (
    <ModelOptionButton
      model={model}
      selected={selected}
      onSelect={onSelectModel}
      subtitle={`${model.connection_label} · ${model.id}`}
    >
      {description ? <p className="mt-1 max-w-[66ch] text-ui text-muted">{description}</p> : null}
      <div className="mt-1 flex flex-wrap gap-3">
        {contextLabel ? <Readout label="Context">{contextLabel}</Readout> : null}
        {dimensionLabel ? <Readout label="Dimension">{dimensionLabel}</Readout> : null}
        {promptLabel ? <Readout label="Prompt">{promptLabel}</Readout> : null}
        {completionLabel ? <Readout label="Completion">{completionLabel}</Readout> : null}
      </div>
    </ModelOptionButton>
  );
}

/** Whether the saved selection is missing from the catalog, and the connection label to show. */
function resolveEmbeddingSelection({
  models,
  currentModelInfo,
  selectedModelKey,
  selectedConnectionId,
  selectedConnectionLabel,
  selectedAvailability,
  modelsLoading,
  modelsError,
}: {
  models: CatalogModel[];
  currentModelInfo: CatalogModel | null;
  selectedModelKey: string;
  selectedConnectionId?: string | null;
  selectedConnectionLabel?: string | null;
  selectedAvailability?: "available" | "unknown" | "missing";
  modelsLoading: boolean;
  modelsError: string | null;
}): { selectionUnavailable: boolean; connectionLabel: string } {
  const selectionUnavailable = Boolean(
    selectedAvailability === "missing" ||
    (selectedAvailability === undefined &&
      selectedModelKey &&
      selectedConnectionId &&
      !currentModelInfo &&
      !modelsLoading &&
      !modelsError),
  );
  const connectionLabel =
    currentModelInfo?.connection_label ??
    selectedConnectionLabel ??
    models.find((model) => model.connection_id === selectedConnectionId)?.connection_label ??
    "this connection";
  return { selectionUnavailable, connectionLabel };
}

type EmbeddingModelSelectorCardProps = {
  models: CatalogModel[];
  selectedModelKey: string;
  selectedConnectionId?: string | null;
  selectedConnectionLabel?: string | null;
  selectedAvailability?: "available" | "unknown" | "missing";
  onSelectModel: (model: CatalogModel) => void;
  modelsLoading: boolean;
  modelsError: string | null;
};

/**
 * The embedding model picker: the shared {@link ModelCatalogPicker} chrome with
 * embedding-specific sort (price / dimension), the selected model's vector
 * dimension surfaced beside the sort control, and per-model pricing/dimension
 * badges. Auto-fills the vector dimension when a model is chosen.
 */
export function EmbeddingModelSelectorCard({
  models,
  selectedModelKey,
  selectedConnectionId,
  selectedConnectionLabel,
  selectedAvailability,
  onSelectModel,
  modelsLoading,
  modelsError,
}: EmbeddingModelSelectorCardProps) {
  const { searchTerm, setSearchTerm, sortValue, setSortValue, filteredModels } =
    useModelCatalogFilter({ models, sortOptions: EMBEDDING_MODEL_SORTS });

  const currentModelInfo =
    models.find(
      (model) => model.id === selectedModelKey && model.connection_id === selectedConnectionId,
    ) ?? null;
  const { selectionUnavailable, connectionLabel } = resolveEmbeddingSelection({
    models,
    currentModelInfo,
    selectedModelKey,
    selectedConnectionId,
    selectedConnectionLabel,
    selectedAvailability,
    modelsLoading,
    modelsError,
  });

  return (
    <ModelCatalogPicker
      models={filteredModels}
      selectedModelKey={selectedModelKey}
      currentModel={currentModelInfo}
      headerPlaceholder="Select an embedding model"
      headerSubtitle={selectedModelKey || null}
      description="Pick an embedding model from any connected provider to auto-fill its vector dimension."
      modelsLoading={modelsLoading}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      searchPlaceholder="Search embedding models…"
      sortOptions={EMBEDDING_MODEL_SORTS}
      sortValue={sortValue}
      onSortChange={setSortValue}
      controlsLeading={
        <div className="flex flex-1 items-center justify-between gap-2 rounded-control border border-hairline bg-surface px-3 py-2">
          <InstrumentLabel>Dimension</InstrumentLabel>
          <span className="font-mono text-ui tabular-nums text-primary">
            {currentModelInfo?.dimension ? (
              currentModelInfo.dimension.toLocaleString()
            ) : (
              <span className="text-muted">—</span>
            )}
          </span>
        </div>
      }
      modelsError={modelsError}
      unavailable={
        selectionUnavailable
          ? {
              key: selectedModelKey,
              connectionLabel,
              message: `Selected model is no longer available from ${connectionLabel}. Select another model.`,
            }
          : null
      }
      noun="embedding model"
      emptyLabel="No embedding models available."
      renderModel={(model) => (
        <EmbeddingModelRow
          key={`${model.connection_id}::${model.id}`}
          model={model}
          selectedModelKey={selectedModelKey}
          selectedConnectionId={selectedConnectionId}
          onSelectModel={onSelectModel}
        />
      )}
    />
  );
}
