"use client";

import { ModelPickerInline } from "@/components/models/ModelPickerInline";

import type { ModelAvailability } from "@/lib/model-catalog-cache";
import type { CatalogModel } from "@/lib/types";

type LlmModelSelectorCardProps = {
  models: CatalogModel[];
  selectedModelKey: string;
  selectedConnectionId?: string | null;
  selectedAvailability: ModelAvailability;
  onSelectModel: (model: CatalogModel) => void;
  onRetry: () => void;
  modelsLoading: boolean;
  modelsError: string | null;
};

/**
 * The chat-model picker for LLM pipeline nodes: the shared
 * {@link ModelPickerInline} over the structured-output-capable chat catalog.
 */
export function LlmModelSelectorCard({
  models,
  selectedModelKey,
  selectedConnectionId,
  selectedAvailability,
  onSelectModel,
  onRetry,
  modelsLoading,
  modelsError,
}: LlmModelSelectorCardProps) {
  const connectionLabel =
    models.find(
      (model) => model.id === selectedModelKey && model.connection_id === selectedConnectionId,
    )?.connection_label ??
    models.find((model) => model.connection_id === selectedConnectionId)?.connection_label ??
    selectedConnectionId;

  return (
    <ModelPickerInline
      kind="chat"
      models={models}
      selectedConnectionId={selectedConnectionId}
      selectedModelId={selectedModelKey || null}
      onSelectModel={onSelectModel}
      loading={modelsLoading}
      modelsError={modelsError}
      onRetry={onRetry}
      copy={{
        placeholder: "Select a chat model",
        searchPlaceholder: "Search chat models…",
        emptyLabel: "No chat models with structured outputs available.",
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
