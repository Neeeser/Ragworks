"use client";

import { useModelCatalogFilter } from "@/components/models/model-catalog-filter";
import { ModelCatalogPicker } from "@/components/models/ModelCatalogPicker";
import { ModelOptionButton } from "@/components/models/ModelOptionButton";
import { Chip } from "@/components/ui/chip";
import { Readout } from "@/components/ui/readout";

import type { ModelAvailability } from "@/lib/model-catalog-cache";
import type { CatalogModel, ProviderType } from "@/lib/types";

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

const PROVIDER_LABELS: Record<ProviderType, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama",
  cohere: "Cohere",
  tei: "TEI",
  custom: "Custom",
  pinecone: "Pinecone",
};

const modalityLabel = (modality: string) =>
  modality.length > 0 ? `${modality[0]?.toUpperCase()}${modality.slice(1)}` : modality;

/**
 * The reranking model picker: the shared {@link ModelCatalogPicker} chrome with
 * reranking-specific badges (input-token limit and input modalities) and a
 * retry affordance on catalog errors. Rerankers have no price/dimension sort.
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
  const { searchTerm, setSearchTerm, filteredModels } = useModelCatalogFilter({ models });

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
    <ModelCatalogPicker
      models={filteredModels}
      selectedModelKey={selectedModelKey}
      currentModel={currentModel}
      headerPlaceholder="Select a reranking model"
      headerSubtitle={selectedModelKey || null}
      modelsLoading={modelsLoading}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      searchPlaceholder="Search reranking models…"
      searchAriaLabel="Search reranking models"
      modelsError={modelsError}
      onRetry={onRetry}
      unavailable={
        selectedAvailability === "missing"
          ? {
              key: selectedModelKey,
              connectionLabel: connectionLabel ?? "Unknown connection",
              message: `Selected model is no longer available from ${
                connectionLabel ?? "this connection"
              }. Select another model.`,
            }
          : null
      }
      noun="reranking model"
      emptyLabel="No reranking models available."
      renderModel={(model) => {
        const selected =
          model.id === selectedModelKey && model.connection_id === selectedConnectionId;
        const inputLimit = model.context_length ?? model.max_input_tokens;
        return (
          <ModelOptionButton
            key={`${model.connection_id}::${model.id}`}
            model={model}
            selected={selected}
            onSelect={onSelectModel}
            subtitle={
              <>
                <span className="block">
                  {model.connection_label} · {PROVIDER_LABELS[model.provider_type]}
                </span>
                <span className="block">{model.id}</span>
              </>
            }
          >
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {inputLimit ? (
                <Readout label="Max input">{inputLimit.toLocaleString()}</Readout>
              ) : null}
              {model.input_modalities.map((modality) => (
                <Chip key={modality} dot={false}>
                  {modalityLabel(modality)}
                </Chip>
              ))}
            </div>
          </ModelOptionButton>
        );
      }}
    />
  );
}
