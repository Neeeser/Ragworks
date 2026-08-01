"use client";

import { Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { CapabilityFilterChips } from "@/components/models/CapabilityFilterChips";
import {
  buildConnectionOptions,
  filterModelsBySearch,
  modelKey,
  sortModelsBy,
} from "@/components/models/model-catalog-filter";
import { ModelCatalogList } from "@/components/models/ModelCatalogList";
import { ModelDetailPane } from "@/components/models/ModelDetailPane";
import { CustomSelect } from "@/components/ui/custom-select";
import { inputClass } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { availableCapabilities, filterModelsByCapabilities } from "@/lib/model-capabilities";
import { cn } from "@/lib/utils";

import type { ModelSortDef } from "@/components/models/model-catalog-filter";
import type { ModelCapabilityId } from "@/lib/model-capabilities";
import type { CatalogModel } from "@/lib/types";
import type { ReactNode } from "react";

const ALL_PROVIDERS = "";

export interface ModelBrowserOverlayProps {
  models: CatalogModel[];
  selectedKey: string | null;
  onSelect: (model: CatalogModel) => void;
  onClose: () => void;
  isPinned: (model: CatalogModel) => boolean;
  onTogglePin: (model: CatalogModel) => void;
  loading: boolean;
  searchPlaceholder: string;
  emptyLabel: string;
  sortOptions?: ModelSortDef[];
  renderTrailing?: (model: CatalogModel) => ReactNode;
}

/**
 * The full model catalog with room to read it: provider drawers on the left,
 * everything known about the focused model on the right.
 *
 * Capability chips are the primary narrowing control here — "the models that
 * take images and call tools" is the question users actually ask, which
 * sorting by price never answered. Provider and sort stay as dropdowns beside
 * them, so nothing the inline picker could do is missing.
 *
 * Below `lg` the two panes become one: the list fills the sheet and the detail
 * slides over it, since a side-by-side split at phone width leaves neither
 * pane readable.
 */
export function ModelBrowserOverlay({
  models,
  selectedKey,
  onSelect,
  onClose,
  isPinned,
  onTogglePin,
  loading,
  searchPlaceholder,
  emptyLabel,
  sortOptions,
  renderTrailing,
}: ModelBrowserOverlayProps) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [capabilities, setCapabilities] = useState<ModelCapabilityId[]>([]);
  const [connectionFilter, setConnectionFilter] = useState(ALL_PROVIDERS);
  const [sortValue, setSortValue] = useState(sortOptions?.[0]?.value ?? "");
  const [focusedKey, setFocusedKey] = useState<string | null>(selectedKey);

  const connectionOptions = useMemo(() => buildConnectionOptions(models), [models]);
  const offeredCapabilities = useMemo(() => availableCapabilities(models), [models]);

  const listed = useMemo(() => {
    const scoped = connectionFilter
      ? models.filter((model) => model.connection_id === connectionFilter)
      : models;
    const byCapability = filterModelsByCapabilities(scoped, capabilities);
    const searched = filterModelsBySearch(byCapability, search);
    return sortValue ? sortModelsBy(searched, sortValue) : searched;
  }, [models, connectionFilter, capabilities, search, sortValue]);

  const focused =
    models.find((model) => modelKey(model.connection_id, model.id) === focusedKey) ?? null;

  const toggleCapability = (capability: ModelCapabilityId) =>
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((entry) => entry !== capability)
        : [...current, capability],
    );

  return (
    <ModalOverlay
      open
      onClose={onClose}
      labelledBy={titleId}
      backdropClassName="bg-canvas/80 px-0 py-0 sm:px-4 sm:py-8"
    >
      <div className="card-surface relative flex h-[100dvh] w-full flex-col overflow-hidden bg-canvas-raised text-primary shadow-elevation-2 sm:h-[calc(100vh-4rem)] sm:max-w-5xl">
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <h2 id={titleId} className="shrink-0 text-head font-semibold tracking-[-0.01em]">
            Models
          </h2>
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-meta"
              aria-hidden
            />
            <input
              type="search"
              aria-label={searchPlaceholder}
              className={cn(inputClass, "pl-9")}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button
            type="button"
            aria-label="Close model browser"
            onClick={onClose}
            className="shrink-0 rounded-control p-1 text-muted hover:text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-2 border-b border-hairline px-4 py-2 lg:flex-row lg:items-center">
          <CapabilityFilterChips
            available={offeredCapabilities}
            selected={capabilities}
            onToggle={toggleCapability}
            className="min-w-0 flex-1"
          />
          <div className="flex shrink-0 gap-2">
            {connectionOptions.length > 1 ? (
              <div className="w-full lg:w-44">
                <CustomSelect
                  aria-label="Filter models by provider"
                  value={connectionFilter}
                  placeholder="All providers"
                  options={[
                    { value: ALL_PROVIDERS, label: "All providers" },
                    ...connectionOptions.map((option) => ({
                      value: option.connectionId,
                      label: option.label,
                    })),
                  ]}
                  onValueChange={setConnectionFilter}
                />
              </div>
            ) : null}
            {sortOptions && sortOptions.length > 0 ? (
              <div className="w-full lg:w-44">
                <CustomSelect
                  aria-label="Sort models"
                  value={sortValue}
                  placeholder={sortOptions[0]?.label ?? "Sort"}
                  options={sortOptions.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  onValueChange={setSortValue}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-3 lg:w-[46%] lg:flex-none lg:border-r lg:border-hairline",
              focused && "hidden lg:block",
            )}
          >
            <ModelCatalogList
              models={listed}
              allModels={models}
              selectedKey={focusedKey}
              onSelect={(model) => setFocusedKey(modelKey(model.connection_id, model.id))}
              isPinned={isPinned}
              onTogglePin={onTogglePin}
              searching={search.trim().length > 0 || capabilities.length > 0}
              loading={loading}
              emptyLabel={search ? `No models match "${search}".` : emptyLabel}
              renderTrailing={renderTrailing}
            />
          </div>
          <div className={cn("min-h-0 flex-1", !focused && "hidden lg:block")}>
            {focused ? (
              <ModelDetailPane
                model={focused}
                selected={selectedKey === focusedKey}
                pinned={isPinned(focused)}
                onTogglePin={onTogglePin}
                onSelect={onSelect}
                onBack={() => setFocusedKey(null)}
              />
            ) : (
              <p className="p-4 text-ui text-muted">
                Select a model to see its capabilities, context, and pricing.
              </p>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
