"use client";

import { Check, Loader, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { formatPricePerMillion } from "@/lib/format";
import { sortEmbeddingModels, type EmbeddingModelSortOption } from "@/lib/model-sorting";
import { cn } from "@/lib/utils";

import type { EmbeddingModelInfo } from "@/lib/types";

type EmbeddingModelSelectorCardProps = {
  models: EmbeddingModelInfo[];
  selectedModelKey: string;
  onSelectModel: (id: string) => void;
  modelsLoading: boolean;
  modelsError: string | null;
};

/**
 * Owns the search/sort state for an embedding model catalog. Previously this
 * filter+sort pipeline was duplicated across PipelineBuilder, IndexManagerModal, and
 * (via prop drilling) PipelineInspector; centralizing it here lets every caller just
 * pass the raw model list.
 */
export function useEmbeddingModelFilter(models: EmbeddingModelInfo[]) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState<EmbeddingModelSortOption>("price");

  const filteredModels = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const matching = term
      ? models.filter((model) => {
          const haystack = `${model.name} ${model.id} ${model.description ?? ""}`.toLowerCase();
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
  onSelectModel,
  modelsLoading,
  modelsError,
}: EmbeddingModelSelectorCardProps) {
  const { searchTerm, setSearchTerm, sortOption, setSortOption, filteredModels } =
    useEmbeddingModelFilter(models);
  const currentModelInfo = models.find((model) => model.id === selectedModelKey) ?? null;
  const visibleModels = filteredModels.slice(0, 50);
  const formatCost = (value?: number | string | null) => formatPricePerMillion(value);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-300">
            {currentModelInfo?.name || selectedModelKey || "Select an embedding model"}
          </p>
          {selectedModelKey && (
            <p className="text-[11px] text-slate-500 break-all">{selectedModelKey}</p>
          )}
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.3em] text-slate-500">
          {modelsLoading && (
            <span className="inline-flex items-center gap-1 text-slate-300">
              <Loader className="h-3.5 w-3.5" />
              Syncing
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Pick an OpenRouter embedding model to auto-fill its vector dimension.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          className="w-full rounded-2xl border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400"
          placeholder="Search OpenRouter embeddings…"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>
      {modelsError && <p className="text-sm text-rose-300">{modelsError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Dimension</span>
            <span>
              {currentModelInfo?.dimension
                ? currentModelInfo.dimension.toLocaleString()
                : "Select a model"}
            </span>
          </div>
        </div>
        <div className="min-w-[160px]">
          <select
            className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400"
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
          <p className="text-sm text-slate-400">Loading embedding models…</p>
        ) : visibleModels.length === 0 ? (
          <p className="text-sm text-slate-400">
            {searchTerm ? `No models match "${searchTerm}".` : "No embedding models available."}
          </p>
        ) : (
          visibleModels.map((model) => {
            const isSelected = selectedModelKey && model.id === selectedModelKey;
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
                key={model.id}
                type="button"
                onClick={() => onSelectModel(model.id)}
                className={cn(
                  "w-full rounded-2xl border px-3 py-2 text-left transition",
                  isSelected
                    ? "border-violet-400 bg-violet-500/10 text-white"
                    : "border-white/10 bg-white/5 text-slate-200 hover:border-white/40",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{model.name}</p>
                    <p className="text-[11px] text-slate-500 break-all">{model.id}</p>
                  </div>
                  {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-violet-300" />}
                </div>
                {description && <p className="mt-2 text-xs text-slate-400">{description}</p>}
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.3em] text-slate-500">
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
