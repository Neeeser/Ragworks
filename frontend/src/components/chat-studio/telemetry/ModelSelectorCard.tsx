"use client";

import { CHAT_MODEL_SORTS } from "@/components/models/model-catalog-filter";
import { ModelPickerInline } from "@/components/models/ModelPickerInline";
import { formatContextLength } from "@/lib/format";

import type { ChatModelSortOption } from "@/lib/model-sorting";
import type { CatalogModel } from "@/lib/types";

interface ModelSelectorCardProps {
  currentModelInfo: CatalogModel | null;
  selectedModelKey: string;
  selectedConnectionId?: string | null;
  toolReadyModels: CatalogModel[];
  filteredModelCatalog: CatalogModel[];
  modelsLoading: boolean;
  modelsError: string | null;
  toolsEnabled: boolean;
  onSelectModel: (model: CatalogModel) => void;
  onSortChange?: (value: ChatModelSortOption) => void;
}

/**
 * The chat model picker. Renders the shared {@link ModelPickerInline} over the
 * chat catalog, adding the tool-readiness copy and each model's context
 * length. Search, provider filter, and sort state now live in the picker
 * itself; the catalog hook keeps only what the parameter panel also reads.
 */
export const ModelSelectorCard = ({
  currentModelInfo,
  selectedModelKey,
  selectedConnectionId,
  toolReadyModels,
  filteredModelCatalog,
  modelsLoading,
  modelsError,
  toolsEnabled,
  onSelectModel,
}: ModelSelectorCardProps) => {
  const showUnavailable =
    Boolean(selectedModelKey) &&
    !currentModelInfo &&
    Boolean(modelsError?.includes("no longer available"));

  return (
    <ModelPickerInline
      kind="chat"
      models={filteredModelCatalog}
      selectedConnectionId={selectedConnectionId ?? currentModelInfo?.connection_id ?? null}
      selectedModelId={currentModelInfo?.id ?? selectedModelKey ?? null}
      onSelectModel={onSelectModel}
      loading={modelsLoading}
      modelsError={modelsError}
      copy={{
        placeholder: toolsEnabled ? "Select a tool-enabled model" : "Select a model",
        searchPlaceholder: "Search models across providers…",
        emptyLabel: toolsEnabled ? "No tool-enabled models available." : "No models available.",
        description: toolsEnabled
          ? "Tool-enabled models are required when collection tools are active."
          : undefined,
      }}
      headerAccessory={
        <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
          {toolReadyModels.length} ready
        </span>
      }
      sortOptions={CHAT_MODEL_SORTS}
      renderTrailing={(model) =>
        model.context_length ? formatContextLength(model.context_length) : null
      }
      unavailable={showUnavailable ? { modelId: selectedModelKey } : null}
    />
  );
};
