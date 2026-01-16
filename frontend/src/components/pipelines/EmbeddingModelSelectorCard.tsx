"use client";

import { Check, Loader, Search } from "lucide-react";

import { cn } from "@/lib/utils";

import type { EmbeddingModelSortOption } from "@/lib/model-sorting";
import type { EmbeddingModelInfo } from "@/lib/types";

type EmbeddingModelSelectorCardProps = {
  currentModelInfo: EmbeddingModelInfo | null;
  selectedModelKey: string;
  filteredModelCatalog: EmbeddingModelInfo[];
  modelSearchTerm: string;
  onSearchChange: (value: string) => void;
  modelsLoading: boolean;
  modelsError: string | null;
  onSelectModel: (id: string) => void;
  sortOption: EmbeddingModelSortOption;
  onSortChange: (value: EmbeddingModelSortOption) => void;
};

const formatPricePerMillion = (value?: number | string | null): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const raw =
    typeof value === "number"
      ? value
      : Number(
          String(value)
            .trim()
            .replace(/[^0-9eE.+-]/g, ""),
        );
  if (!Number.isFinite(raw)) {
    const fallback = String(value).trim();
    return fallback || null;
  }
  const pricePerMillion = raw * 1_000_000;
  const trimFractionDigits = (numericString: string, minFractionDigits: number) => {
    if (!numericString.includes(".")) {
      return numericString;
    }
    const [whole, fraction] = numericString.split(".");
    if (fraction.length <= minFractionDigits) {
      return `${whole}.${fraction.padEnd(minFractionDigits, "0")}`;
    }
    let trimmedFraction = fraction;
    while (trimmedFraction.length > minFractionDigits && trimmedFraction.endsWith("0")) {
      trimmedFraction = trimmedFraction.slice(0, -1);
    }
    /* c8 ignore next -- minFractionDigits is never zero when a fraction exists */
    return trimmedFraction.length > 0 ? `${whole}.${trimmedFraction}` : whole;
  };

  let minFractionDigits = 0;
  let maxFractionDigits = 0;
  if (pricePerMillion >= 100) {
    minFractionDigits = 0;
    maxFractionDigits = 0;
  } else if (pricePerMillion >= 10) {
    minFractionDigits = 1;
    maxFractionDigits = 1;
  } else if (pricePerMillion >= 1) {
    minFractionDigits = 2;
    maxFractionDigits = 2;
  } else if (pricePerMillion >= 0.1) {
    minFractionDigits = 2;
    maxFractionDigits = 3;
  } else if (pricePerMillion >= 0.01) {
    minFractionDigits = 2;
    maxFractionDigits = 4;
  } else {
    minFractionDigits = 2;
    maxFractionDigits = 6;
  }
  const fixed = pricePerMillion.toFixed(maxFractionDigits);
  const normalized = trimFractionDigits(fixed, minFractionDigits);
  return `$${normalized}/M`;
};

export function EmbeddingModelSelectorCard({
  currentModelInfo,
  selectedModelKey,
  filteredModelCatalog,
  modelSearchTerm,
  onSearchChange,
  modelsLoading,
  modelsError,
  onSelectModel,
  sortOption,
  onSortChange,
}: EmbeddingModelSelectorCardProps) {
  const visibleModels = filteredModelCatalog.slice(0, 50);
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
          value={modelSearchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
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
            onChange={(event) => onSortChange(event.target.value as EmbeddingModelSortOption)}
          >
            <option value="price">Sort by price</option>
            <option value="dimension">Sort by dimension</option>
          </select>
        </div>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {modelsLoading && filteredModelCatalog.length === 0 ? (
          <p className="text-sm text-slate-400">Loading embedding models…</p>
        ) : visibleModels.length === 0 ? (
          <p className="text-sm text-slate-400">
            {modelSearchTerm
              ? `No models match "${modelSearchTerm}".`
              : "No embedding models available."}
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
