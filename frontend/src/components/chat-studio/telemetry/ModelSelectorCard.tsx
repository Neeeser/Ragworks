"use client";

import { Check, Loader, Search } from "lucide-react";

import { formatContextLength, formatPricePerMillion } from "@/lib/format";
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
          <p className="text-sm text-body">
            {currentModelInfo?.name || selectedModelKey || "Select a tool-enabled model"}
          </p>
          {selectedModelKey && (
            <p className="text-[11px] text-meta break-all">{selectedModelKey}</p>
          )}
        </div>
        <div className="text-right font-mono text-[11px] uppercase tracking-[0.2em] text-meta">
          <span>{toolReadyModels.length} ready</span>
          {modelsLoading && (
            <span className="ml-2 inline-flex items-center gap-1 text-body">
              <Loader className="h-3.5 w-3.5" />
              Syncing
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-muted">
        {toolsEnabled
          ? "Tool-enabled models are required when collection tools are active."
          : "All OpenRouter chat models are available for standalone conversations."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" />
          <input
            type="search"
            className="w-full rounded-2xl border border-hairline bg-surface py-2 pl-9 pr-3 text-sm text-primary outline-none placeholder:text-meta focus:border-accent-violet"
            placeholder="Search OpenRouter models…"
            value={modelSearchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className="min-w-[160px]">
          <select
            className="w-full rounded-2xl border border-hairline bg-surface px-3 py-2 text-xs text-body outline-none focus:border-accent-violet"
            value={sortOption}
            onChange={(event) => onSortChange(event.target.value as ChatModelSortOption)}
          >
            <option value="default">Default order</option>
            <option value="price">Sort by price</option>
          </select>
        </div>
      </div>
      {modelsError && <p className="text-sm text-data-neg">{modelsError}</p>}
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {modelsLoading && toolReadyModels.length === 0 ? (
          <p className="text-sm text-muted">Loading tool-compatible models…</p>
        ) : visibleModels.length === 0 ? (
          <p className="text-sm text-muted">
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
              ? formatContextLength(model.context_length)
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
                    ? "border-accent-violet bg-accent-violet/10 text-primary"
                    : "border-hairline bg-surface text-body hover:border-strong",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary">{model.name}</p>
                    <p className="text-[11px] text-meta break-all">{model.id}</p>
                  </div>
                  {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-accent-violet" />}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                  {contextLabel && (
                    <span className="text-body">
                      <span className="mr-1.5 text-[10px] uppercase tracking-[0.2em] text-meta">
                        ctx
                      </span>
                      {contextLabel}
                    </span>
                  )}
                  {promptLabel && (
                    <span className="text-body">
                      <span className="mr-1.5 text-[10px] uppercase tracking-[0.2em] text-meta">
                        in
                      </span>
                      {promptLabel}
                    </span>
                  )}
                  {completionLabel && (
                    <span className="text-body">
                      <span className="mr-1.5 text-[10px] uppercase tracking-[0.2em] text-meta">
                        out
                      </span>
                      {completionLabel}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
