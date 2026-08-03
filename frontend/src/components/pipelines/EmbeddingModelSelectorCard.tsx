"use client";

import { EMBEDDING_MODEL_SORTS } from "@/components/models/model-catalog-filter";
import { ModelPickerInline } from "@/components/models/ModelPickerInline";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import { useResolvedEmbeddingDimension } from "./hooks/use-resolved-embedding-dimension";

import type { CatalogModel } from "@/lib/types";

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
  /** Resolves the "Dimension" readout for a model the catalog publishes no
   * width for (OpenRouter publishes none for any embedding model), via a
   * single memoised endpoint lookup. Omitted callers see the catalog's own
   * `dimension` only, same as before. */
  token?: string | null;
};

/**
 * The embedding model picker: the shared {@link ModelPickerInline} over the
 * embedding catalog, with the vector dimension on every row and beside the
 * controls — dimension is the field that decides whether a model can serve an
 * existing index, so it is the one measure worth carrying everywhere. Per-row
 * dimensions (`renderTrailing`) read the catalog only, never probing a whole
 * list of models; only the one selected model's readout resolves further.
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
  token,
}: EmbeddingModelSelectorCardProps) {
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
  const resolvedDimension = useResolvedEmbeddingDimension(
    token ?? null,
    selectedConnectionId ?? null,
    selectedModelKey || null,
    currentModelInfo?.dimension,
  );

  return (
    <ModelPickerInline
      kind="embedding"
      models={models}
      selectedConnectionId={selectedConnectionId}
      selectedModelId={selectedModelKey || null}
      onSelectModel={onSelectModel}
      loading={modelsLoading}
      modelsError={modelsError}
      copy={{
        placeholder: "Select an embedding model",
        searchPlaceholder: "Search embedding models…",
        emptyLabel: "No embedding models available.",
      }}
      sortOptions={EMBEDDING_MODEL_SORTS}
      renderTrailing={(model) => (model.dimension ? `${model.dimension.toLocaleString()}d` : null)}
      controlsLeading={
        <div className="flex flex-1 items-center justify-between gap-2 rounded-control border border-hairline bg-surface px-3 py-2">
          <InstrumentLabel>Dimension</InstrumentLabel>
          <span className="font-mono text-ui tabular-nums text-primary">
            {resolvedDimension ? (
              resolvedDimension.toLocaleString()
            ) : (
              <span className="text-muted">—</span>
            )}
          </span>
        </div>
      }
      unavailable={
        selectionUnavailable
          ? {
              modelId: selectedModelKey,
              connectionLabel,
              message: `Selected model is no longer available from ${connectionLabel}. Select another model.`,
            }
          : null
      }
    />
  );
}
