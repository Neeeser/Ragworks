"use client";

import { ModelPickerInline } from "@/components/models/ModelPickerInline";

import type { ModelAvailability } from "@/lib/model-catalog-cache";
import type { CatalogModel } from "@/lib/types";

type RerankingModelSelectorCardProps = {
  models: CatalogModel[];
  selectedModelKey: string;
  selectedConnectionId?: string | null;
  selectedConnectionLabel?: string | null;
  selectedAvailability: ModelAvailability;
  onSelectModel: (model: CatalogModel) => void;
  onRetry: () => void;
  modelsLoading: boolean;
  modelsError: string | null;
};

/**
 * The reranking model picker: the shared {@link ModelPickerInline} over the
 * reranking catalog, carrying each model's input-token limit — the measure
 * that decides how much retrieved text a reranker can score in one call.
 */
export function RerankingModelSelectorCard({
  models,
  selectedModelKey,
  selectedConnectionId,
  selectedConnectionLabel,
  selectedAvailability,
  onSelectModel,
  onRetry,
  modelsLoading,
  modelsError,
}: RerankingModelSelectorCardProps) {
  const currentModel =
    models.find(
      (model) => model.id === selectedModelKey && model.connection_id === selectedConnectionId,
    ) ?? null;
  const connectionLabel =
    currentModel?.connection_label ??
    selectedConnectionLabel ??
    models.find((model) => model.connection_id === selectedConnectionId)?.connection_label ??
    selectedConnectionId;

  return (
    <ModelPickerInline
      kind="reranking"
      models={models}
      selectedConnectionId={selectedConnectionId}
      selectedModelId={selectedModelKey || null}
      onSelectModel={onSelectModel}
      loading={modelsLoading}
      modelsError={modelsError}
      onRetry={onRetry}
      copy={{
        placeholder: "Select a reranking model",
        searchPlaceholder: "Search reranking models…",
        emptyLabel: "No reranking models available.",
      }}
      renderTrailing={(model) => {
        const inputLimit = model.context_length ?? model.max_input_tokens;
        return inputLimit ? inputLimit.toLocaleString() : null;
      }}
      unavailable={
        selectedAvailability === "missing"
          ? {
              modelId: selectedModelKey,
              connectionLabel: connectionLabel ?? "Unknown connection",
              message: `Selected model is no longer available from ${
                connectionLabel ?? "this connection"
              }. Select another model.`,
            }
          : null
      }
    />
  );
}
