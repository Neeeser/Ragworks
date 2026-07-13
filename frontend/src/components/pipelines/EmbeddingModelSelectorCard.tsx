"use client";

import { Check, Loader, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { formatPricePerMillion } from "@/lib/format";
import { sortEmbeddingModels, type EmbeddingModelSortOption } from "@/lib/model-sorting";
import { cn } from "@/lib/utils";

import type { CatalogModel } from "@/lib/types";

type EmbeddingModelSelectorCardProps = {
  models: CatalogModel[];
  selectedModelKey: string;
  selectedConnectionId?: string | null;
  onSelectModel: (model: CatalogModel) => void;
  modelsLoading: boolean;
  modelsError: string | null;
};

/**
 * Owns the search/sort state for an embedding model catalog. Previously this
 * filter+sort pipeline was duplicated across PipelineBuilder, IndexManagerModal, and
 * (via prop drilling) the node editor; centralizing it here lets every caller just
 * pass the raw model list.
 */
export function useEmbeddingModelFilter(models: CatalogModel[]) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState<EmbeddingModelSortOption>("price");

  const filteredModels = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const matching = term
      ? models.filter((model) => {
          const haystack =
            `${model.name} ${model.id} ${model.connection_label} ${model.description ?? ""}`.toLowerCase();
          return haystack.includes(term);
        })
      : models;
    return sortEmbeddingModels(matching, sortOption);
  }, [models, searchTerm, sortOption]);

  return { searchTerm, setSearchTerm, sortOption, setSortOption, filteredModels };
}

export function EmbeddingModelSelectorCard({
  models,
  selectedModelKey,
  selectedConnectionId,
  onSelectModel,
  modelsLoading,
  modelsError,
}: EmbeddingModelSelectorCardProps) {
  const { searchTerm, setSearchTerm, sortOption, setSortOption, filteredModels } =
    useEmbeddingModelFilter(models);
  const currentModelInfo =
    models.find(
      (model) =>
        model.id === selectedModelKey &&
        (!selectedConnectionId || model.connection_id === selectedConnectionId),
    ) ??
    models.find((model) => model.id === selectedModelKey) ??
    null;
  const visibleModels = filteredModels.slice(0, 50);
  const formatCost = (value?: number | string | null) => formatPricePerMillion(value);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-body">
            {currentModelInfo?.name || selectedModelKey || "Select an embedding model"}
          </p>
          {selectedModelKey && (
            <p className="text-[11px] text-meta break-all">{selectedModelKey}</p>
          )}
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.3em] text-meta">
          {modelsLoading && (
            <span className="inline-flex items-center gap-1 text-body">
              <Loader className="h-3.5 w-3.5" />
              Syncing
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-muted">
        Pick an embedding model from any connected provider to auto-fill its vector dimension.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" />
        <input
          type="search"
          className="w-full rounded-2xl border border-hairline bg-surface py-2 pl-9 pr-3 text-sm text-primary outline-none placeholder:text-meta focus:border-accent-violet"
          placeholder="Search embedding models…"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>
      {modelsError && <p className="text-sm text-data-neg">{modelsError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 rounded-2xl border border-hairline bg-surface px-3 py-2 text-xs text-body">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.3em] text-muted">Dimension</span>
            <span>
              {currentModelInfo?.dimension
                ? currentModelInfo.dimension.toLocaleString()
                : "Select a model"}
            </span>
          </div>
        </div>
        <div className="min-w-[160px]">
          <select
            className="w-full rounded-2xl border border-hairline bg-surface px-3 py-2 text-xs text-body outline-none focus:border-accent-violet"
            value={sortOption}
            onChange={(event) => setSortOption(event.target.value as EmbeddingModelSortOption)}
          >
            <option value="price">Sort by price</option>
            <option value="dimension">Sort by dimension</option>
          </select>
        </div>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {modelsLoading && filteredModels.length === 0 ? (
          <p className="text-sm text-muted">Loading embedding models…</p>
        ) : visibleModels.length === 0 ? (
          <p className="text-sm text-muted">
            {searchTerm ? `No models match "${searchTerm}".` : "No embedding models available."}
          </p>
        ) : (
          visibleModels.map((model) => {
            const isSelected =
              selectedModelKey &&
              model.id === selectedModelKey &&
              (!selectedConnectionId || model.connection_id === selectedConnectionId);
            const contextLabel = model.context_length
              ? `${Math.round(model.context_length).toLocaleString()} ctx`
              : null;
            const dimensionLabel = model.dimension
              ? `Dim ${model.dimension.toLocaleString()}`
              : null;
            const promptLabel = formatCost(model.pricing?.prompt);
            const completionLabel = formatCost(model.pricing?.completion);
            const description =
              model.description && model.description.length > 160
                ? `${model.description.slice(0, 157)}...`
                : model.description;
            return (
              <button
                key={`${model.connection_id}::${model.id}`}
                type="button"
                onClick={() => onSelectModel(model)}
                className={cn(
                  "w-full rounded-2xl border px-3 py-2 text-left transition",
                  isSelected
                    ? "border-accent-violet bg-accent-violet/10 text-primary"
                    : "border-hairline bg-surface text-body hover:border-strong",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary">{model.name}</p>
                    <p className="text-[11px] text-meta break-all">
                      {model.connection_label} · {model.id}
                    </p>
                  </div>
                  {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-accent-violet" />}
                </div>
                {description && <p className="mt-2 text-xs text-muted">{description}</p>}
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.3em] text-meta">
                  {contextLabel && <span>{contextLabel}</span>}
                  {dimensionLabel && <span>{dimensionLabel}</span>}
                  {promptLabel && <span>Prompt {promptLabel}</span>}
                  {completionLabel && <span>Completion {completionLabel}</span>}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
