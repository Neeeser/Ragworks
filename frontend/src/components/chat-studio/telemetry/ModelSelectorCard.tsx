"use client";

import { Check, Loader, Search } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ChatModelSortOption } from "@/lib/model-sorting";
import type { ModelInfo } from "@/lib/types";

interface ModelSelectorCardProps {
  currentModelInfo: ModelInfo | null;
  selectedModelKey: string;
  toolReadyModels: ModelInfo[];
  filteredModelCatalog: ModelInfo[];
  modelSearchTerm: string;
  onSearchChange: (value: string) => void;
  sortOption: ChatModelSortOption;
  onSortChange: (value: ChatModelSortOption) => void;
  modelsLoading: boolean;
  modelsError: string | null;
  toolsEnabled: boolean;
  onSelectModel: (id: string) => void;
}

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

export const ModelSelectorCard = ({
  currentModelInfo,
  selectedModelKey,
  toolReadyModels,
  filteredModelCatalog,
  modelSearchTerm,
  onSearchChange,
  sortOption,
  onSortChange,
  modelsLoading,
  modelsError,
  toolsEnabled,
  onSelectModel,
}: ModelSelectorCardProps) => {
  const visibleModels = filteredModelCatalog.slice(0, 50);
  const formatCost = (value?: number | string | null) => formatPricePerMillion(value);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-300">
            {currentModelInfo?.name || selectedModelKey || "Select a tool-enabled model"}
          </p>
          {selectedModelKey && (
            <p className="text-[11px] text-slate-500 break-all">{selectedModelKey}</p>
          )}
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.3em] text-slate-500">
          <span>{toolReadyModels.length} ready</span>
          {modelsLoading && (
            <span className="ml-2 inline-flex items-center gap-1 text-slate-300">
              <Loader className="h-3.5 w-3.5" />
              Syncing
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400">
        {toolsEnabled
          ? "Tool-enabled models are required when collection tools are active."
          : "All OpenRouter chat models are available for standalone conversations."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            className="w-full rounded-2xl border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400"
            placeholder="Search OpenRouter models…"
            value={modelSearchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className="min-w-[160px]">
          <select
            className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-400"
            value={sortOption}
            onChange={(event) => onSortChange(event.target.value as ChatModelSortOption)}
          >
            <option value="default">Default order</option>
            <option value="price">Sort by price</option>
          </select>
        </div>
      </div>
      {modelsError && <p className="text-sm text-rose-300">{modelsError}</p>}
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {modelsLoading && toolReadyModels.length === 0 ? (
          <p className="text-sm text-slate-400">Loading tool-compatible models…</p>
        ) : visibleModels.length === 0 ? (
          <p className="text-sm text-slate-400">
            {modelSearchTerm
              ? `No models match "${modelSearchTerm}".`
              : "No tool-enabled models available."}
          </p>
        ) : (
          visibleModels.map((model) => {
            const isSelected =
              (selectedModelKey && model.id === selectedModelKey) ||
              (selectedModelKey && model.canonical_slug === selectedModelKey);
            const contextLabel = model.context_length
              ? `${model.context_length.toLocaleString()} ctx`
              : null;
            const promptLabel = formatCost(model.pricing?.prompt);
            const completionLabel = formatCost(model.pricing?.completion);
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
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  {contextLabel && <span>{contextLabel}</span>}
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
};
