"use client";

import { modelSelectionKey } from "@/components/chat-studio/hooks/settings/use-model-catalog";
import { CHAT_MODEL_SORTS } from "@/components/models/model-catalog-filter";
import { ModelCatalogPicker } from "@/components/models/ModelCatalogPicker";
import { ModelMetaBadge, ModelOptionButton } from "@/components/models/ModelOptionButton";
import { formatContextLength, formatPricePerMillion } from "@/lib/format";

import type { ConnectionOption } from "@/components/chat-studio/hooks/settings/use-model-catalog";
import type { ChatModelSortOption } from "@/lib/model-sorting";
import type { CatalogModel } from "@/lib/types";

interface ModelSelectorCardProps {
  currentModelInfo: CatalogModel | null;
  selectedModelKey: string;
  toolReadyModels: CatalogModel[];
  filteredModelCatalog: CatalogModel[];
  modelSearchTerm: string;
  onSearchChange: (value: string) => void;
  sortOption: ChatModelSortOption;
  onSortChange: (value: ChatModelSortOption) => void;
  connectionFilter: string;
  onConnectionFilterChange: (connectionId: string) => void;
  connectionOptions: ConnectionOption[];
  modelsLoading: boolean;
  modelsError: string | null;
  toolsEnabled: boolean;
  onSelectModel: (model: CatalogModel) => void;
}

/**
 * The chat model picker. Renders the shared {@link ModelCatalogPicker} chrome
 * over the chat catalog hook's already-filtered list, adding the tool-readiness
 * copy and context/price badges specific to chat. Filter state stays in
 * `useModelCatalog` because it also feeds the parameter panel.
 */
export const ModelSelectorCard = ({
  currentModelInfo,
  selectedModelKey,
  toolReadyModels,
  filteredModelCatalog,
  modelSearchTerm,
  onSearchChange,
  sortOption,
  onSortChange,
  connectionFilter,
  onConnectionFilterChange,
  connectionOptions,
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
    <ModelCatalogPicker
      models={filteredModelCatalog}
      selectedModelKey={selectedModelKey}
      currentModel={currentModelInfo}
      headerPlaceholder="Select a tool-enabled model"
      headerSubtitle={
        currentModelInfo ? `${currentModelInfo.connection_label} · ${currentModelInfo.id}` : null
      }
      headerAccessory={
        <span className="font-mono text-instrument tabular-nums text-meta">
          {toolReadyModels.length} ready
        </span>
      }
      description={
        toolsEnabled
          ? "Tool-enabled models are required when collection tools are active."
          : "Models from every connected chat provider are available for standalone conversations."
      }
      modelsLoading={modelsLoading}
      searchTerm={modelSearchTerm}
      onSearchChange={onSearchChange}
      searchPlaceholder="Search models across providers…"
      connectionOptions={connectionOptions}
      connectionFilter={connectionFilter}
      onConnectionFilterChange={onConnectionFilterChange}
      sortOptions={CHAT_MODEL_SORTS}
      sortValue={sortOption}
      onSortChange={(value) => onSortChange(value as ChatModelSortOption)}
      modelsError={modelsError}
      unavailable={showUnavailable ? { key: selectedModelKey } : null}
      groupByConnection
      noun="tool-compatible model"
      emptyLabel="No tool-enabled models available."
      renderModel={(model) => {
        const modelKey = modelSelectionKey(model.connection_id, model.id);
        const contextLabel = model.context_length
          ? formatContextLength(model.context_length)
          : null;
        const promptLabel = formatPricePerMillion(model.pricing?.prompt);
        const completionLabel = formatPricePerMillion(model.pricing?.completion);
        return (
          <ModelOptionButton
            key={modelKey}
            model={model}
            selected={selectedModelKey === modelKey}
            onSelect={onSelectModel}
          >
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {contextLabel ? <ModelMetaBadge label="Context" value={contextLabel} /> : null}
              {promptLabel ? <ModelMetaBadge label="Prompt" value={promptLabel} /> : null}
              {completionLabel ? (
                <ModelMetaBadge label="Completion" value={completionLabel} />
              ) : null}
            </div>
          </ModelOptionButton>
        );
      }}
    />
  );
};
