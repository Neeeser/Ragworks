"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import {
  buildConnectionOptions,
  filterModelsBySearch,
  sortModelsBy,
} from "@/components/models/model-catalog-filter";
import { ModelCatalogList } from "@/components/models/ModelCatalogList";
import { CustomSelect } from "@/components/ui/custom-select";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import type { ModelSortDef } from "@/components/models/model-catalog-filter";
import type { CatalogModel } from "@/lib/types";
import type { ReactNode } from "react";

const ALL_PROVIDERS = "";

export interface ModelPickerAllTabProps {
  models: CatalogModel[];
  selectedKey: string | null;
  onSelect: (model: CatalogModel) => void;
  isPinned: (model: CatalogModel) => boolean;
  onTogglePin: (model: CatalogModel) => void;
  loading: boolean;
  searchPlaceholder: string;
  emptyLabel: string;
  sortOptions?: ModelSortDef[];
  /** Extra control on the control row (the embedding dimension readout). */
  controlsLeading?: ReactNode;
  renderTrailing?: (model: CatalogModel) => ReactNode;
}

/**
 * The whole catalog, searchable and filterable, inside the inline picker.
 *
 * This is where the previous picker's controls live on: search, the provider
 * dropdown, and sort. They are all still here and still work; they simply sit
 * behind a tab, because a returning user picks from their own models far more
 * often than they search three hundred.
 *
 * Owning its own search and filter state is deliberate — this state is
 * view-local and resets when the user leaves the tab, and lifting it to the
 * picker would make every keystroke re-render the header and shortlist too.
 */
export function ModelPickerAllTab({
  models,
  selectedKey,
  onSelect,
  isPinned,
  onTogglePin,
  loading,
  searchPlaceholder,
  emptyLabel,
  sortOptions,
  controlsLeading,
  renderTrailing,
}: ModelPickerAllTabProps) {
  const [search, setSearch] = useState("");
  const [connectionFilter, setConnectionFilter] = useState(ALL_PROVIDERS);
  const [sortValue, setSortValue] = useState(sortOptions?.[0]?.value ?? "");

  const connectionOptions = useMemo(() => buildConnectionOptions(models), [models]);
  const listed = useMemo(() => {
    const scoped = connectionFilter
      ? models.filter((model) => model.connection_id === connectionFilter)
      : models;
    const searched = filterModelsBySearch(scoped, search);
    return sortValue ? sortModelsBy(searched, sortValue) : searched;
  }, [models, connectionFilter, search, sortValue]);

  const showProviderFilter = connectionOptions.length > 1;
  const showSort = Boolean(sortOptions && sortOptions.length > 0);

  return (
    <div className="space-y-2">
      <div className="relative">
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

      <div className="flex flex-wrap items-center gap-2">
        {controlsLeading}
        {showProviderFilter ? (
          <div className="min-w-40 flex-1">
            <CustomSelect
              aria-label="Filter models by provider"
              value={connectionFilter}
              placeholder="All providers"
              options={[
                { value: ALL_PROVIDERS, label: "All providers" },
                ...connectionOptions.map((option) => ({
                  value: option.connectionId,
                  label: `${option.label} (${option.providerType})`,
                })),
              ]}
              onValueChange={setConnectionFilter}
            />
          </div>
        ) : null}
        {showSort ? (
          <div className="min-w-40">
            <CustomSelect
              aria-label="Sort models"
              value={sortValue}
              placeholder={sortOptions?.[0]?.label ?? "Sort"}
              options={(sortOptions ?? []).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onValueChange={setSortValue}
            />
          </div>
        ) : null}
      </div>

      <div className="max-h-72 overflow-y-auto pr-1">
        <ModelCatalogList
          models={listed}
          allModels={models}
          selectedKey={selectedKey}
          onSelect={onSelect}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          searching={search.trim().length > 0}
          loading={loading}
          emptyLabel={search ? `No models match "${search}".` : emptyLabel}
          renderTrailing={renderTrailing}
        />
      </div>
    </div>
  );
}
