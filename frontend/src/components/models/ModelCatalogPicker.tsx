"use client";

import { Search } from "lucide-react";

import { groupModelsByConnection } from "@/components/models/model-catalog-filter";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

import type { ConnectionOption, ModelSortDef } from "@/components/models/model-catalog-filter";
import type { CatalogModel } from "@/lib/types";
import type { ReactNode } from "react";

/** The selected model no longer resolves in the catalog; kept visible so the user replaces it. */
export interface UnavailableSelection {
  key: string;
  connectionLabel?: string | null;
  message?: string | null;
}

interface ModelCatalogPickerProps {
  /** The final list to display — already prefiltered, searched, and sorted. */
  models: CatalogModel[];
  selectedModelKey: string;

  // Header
  headerPlaceholder: string;
  currentModel?: CatalogModel | null;
  headerSubtitle?: ReactNode;
  headerAccessory?: ReactNode;
  description?: string;
  modelsLoading: boolean;

  // Search (controlled)
  searchTerm: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel?: string;

  // Provider filter (controlled, optional)
  connectionOptions?: ConnectionOption[];
  connectionFilter?: string;
  onConnectionFilterChange?: (connectionId: string) => void;

  // Sort (controlled, optional)
  sortOptions?: ModelSortDef[];
  sortValue?: string;
  onSortChange?: (value: string) => void;

  /** Extra control rendered on the controls row before the sort dropdown. */
  controlsLeading?: ReactNode;

  // Error + optional retry
  modelsError?: string | null;
  onRetry?: () => void;

  // Unavailable-selection warning
  unavailable?: UnavailableSelection | null;

  // List
  groupByConnection?: boolean;
  noun: string;
  emptyLabel: string;
  /** Renders one model row — the caller composes a {@link ModelOptionButton} with its badges. */
  renderModel: (model: CatalogModel) => ReactNode;
  maxVisible?: number;
}

// Native selects, deliberately, and only until a shared migration lands: the
// chat picker's tests drive these two controls through the `combobox`/`option`
// roles and `fireEvent.change`, which a `CustomSelect` (a Radix button + portal
// listbox) does not expose. Product dropdowns are `CustomSelect` everywhere
// else; the native popup here still cannot follow the product theme.
const controlSelectClass = inputClass;

function PickerHeader({
  currentModel,
  selectedModelKey,
  placeholder,
  subtitle,
  accessory,
  loading,
}: {
  currentModel?: CatalogModel | null;
  selectedModelKey: string;
  placeholder: string;
  subtitle?: ReactNode;
  accessory?: ReactNode;
  loading: boolean;
}) {
  // With no catalog entry the key itself is all we can show, and a model key is
  // an identifier — mono, verbatim.
  const title = currentModel ? (
    currentModel.name
  ) : selectedModelKey ? (
    <span className="font-mono">{selectedModelKey}</span>
  ) : (
    <span className="text-muted">{placeholder}</span>
  );

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-ui font-medium text-primary">{title}</p>
        {subtitle ? <p className="break-all text-instrument text-meta">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {accessory}
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-instrument text-muted">
            <Loader className="h-3 w-3" />
            Syncing
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ProviderFilterSelect({
  options,
  value,
  onChange,
}: {
  options: ConnectionOption[];
  value?: string;
  onChange: (connectionId: string) => void;
}) {
  return (
    <div className="min-w-40 flex-1">
      <select
        aria-label="Filter models by provider"
        className={controlSelectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All providers</option>
        {options.map((option) => (
          <option key={option.connectionId} value={option.connectionId}>
            {option.label} ({option.providerType})
          </option>
        ))}
      </select>
    </div>
  );
}

function SortSelect({
  options,
  value,
  onChange,
}: {
  options: ModelSortDef[];
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-40">
      <select
        aria-label="Sort models"
        className={controlSelectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PickerControls({
  connectionOptions,
  connectionFilter,
  onConnectionFilterChange,
  sortOptions,
  sortValue,
  onSortChange,
  controlsLeading,
}: Pick<
  ModelCatalogPickerProps,
  | "connectionOptions"
  | "connectionFilter"
  | "onConnectionFilterChange"
  | "sortOptions"
  | "sortValue"
  | "onSortChange"
  | "controlsLeading"
>) {
  const showProviderFilter = Boolean(onConnectionFilterChange && connectionOptions);
  const showSort = Boolean(onSortChange && sortOptions && sortOptions.length > 0);
  if (!controlsLeading && !showProviderFilter && !showSort) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {controlsLeading}
      {showProviderFilter ? (
        <ProviderFilterSelect
          options={connectionOptions ?? []}
          value={connectionFilter}
          onChange={(value) => onConnectionFilterChange?.(value)}
        />
      ) : null}
      {showSort ? (
        <SortSelect
          options={sortOptions ?? []}
          value={sortValue}
          onChange={(value) => onSortChange?.(value)}
        />
      ) : null}
    </div>
  );
}

function SelectionStates({
  modelsError,
  onRetry,
  unavailable,
}: {
  modelsError?: string | null;
  onRetry?: () => void;
  unavailable?: UnavailableSelection | null;
}) {
  return (
    <>
      {modelsError && onRetry ? (
        <div className="flex items-center justify-between gap-3 rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2">
          <p className="text-ui text-data-neg">{modelsError}</p>
          <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
      {modelsError && !onRetry ? <p className="text-ui text-data-neg">{modelsError}</p> : null}
      {unavailable ? (
        <div className="rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2">
          <p className="text-ui font-medium text-data-warn">Unavailable</p>
          <p className="break-all font-mono text-instrument text-meta">
            {unavailable.connectionLabel
              ? `${unavailable.connectionLabel} · ${unavailable.key}`
              : unavailable.key}
          </p>
          {unavailable.message ? (
            <p className="mt-1 max-w-[66ch] text-instrument text-muted">{unavailable.message}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ModelList({
  models,
  visibleModels,
  modelsLoading,
  searchTerm,
  noun,
  emptyLabel,
  groupByConnection,
  renderModel,
}: {
  models: CatalogModel[];
  visibleModels: CatalogModel[];
  modelsLoading: boolean;
  searchTerm: string;
  noun: string;
  emptyLabel: string;
  groupByConnection: boolean;
  renderModel: (model: CatalogModel) => ReactNode;
}) {
  const hiddenCount = models.length - visibleModels.length;
  if (modelsLoading && models.length === 0) {
    return <p className="text-ui text-muted">Loading {noun}s…</p>;
  }
  if (visibleModels.length === 0) {
    return (
      <p className="text-ui text-muted">
        {searchTerm ? `No models match "${searchTerm}".` : emptyLabel}
      </p>
    );
  }
  return (
    <>
      {groupByConnection
        ? groupModelsByConnection(visibleModels).map((group) => (
            <div key={group.connectionId} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <InstrumentLabel className="text-body">{group.connectionLabel}</InstrumentLabel>
                {/* A provider type is a backend literal (`openrouter`), not a label. */}
                <span className="font-mono text-instrument text-meta">{group.providerType}</span>
              </div>
              {group.models.map((model) => renderModel(model))}
            </div>
          ))
        : visibleModels.map((model) => renderModel(model))}
      {hiddenCount > 0 ? (
        // Counts stay inside the sentence rather than in mono spans: this is
        // prose, not a column, and the copy reads as one string.
        <p className="text-instrument text-meta">
          Showing {visibleModels.length} of {models.length} models. Search to narrow the list.
        </p>
      ) : null}
    </>
  );
}

/**
 * The shared model picker chrome: selected-model header, search box, optional
 * provider/sort controls, error and unavailable-selection states, and the
 * scrollable model list (flat or grouped by connection). It is fully controlled
 * — the caller owns filter state (via `useModelCatalogFilter` or its own catalog
 * hook) and renders each row through `renderModel`, so chat, embedding,
 * reranking, and eval generation share one look and one set of states.
 *
 * The picker brings no card of its own: it renders inside whatever surface its
 * caller owns (chat's `bg-surface` run-settings pane, a pipeline node drawer, a
 * wizard step), so every fill and wash here has to read on `bg-surface`.
 */
export function ModelCatalogPicker({
  models,
  selectedModelKey,
  headerPlaceholder,
  currentModel,
  headerSubtitle,
  headerAccessory,
  description,
  modelsLoading,
  searchTerm,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  connectionOptions,
  connectionFilter,
  onConnectionFilterChange,
  sortOptions,
  sortValue,
  onSortChange,
  controlsLeading,
  modelsError,
  onRetry,
  unavailable,
  groupByConnection = false,
  noun,
  emptyLabel,
  renderModel,
  maxVisible = 50,
}: ModelCatalogPickerProps) {
  const visibleModels = models.slice(0, maxVisible);

  return (
    <div className="space-y-3">
      <PickerHeader
        currentModel={currentModel}
        selectedModelKey={selectedModelKey}
        placeholder={headerPlaceholder}
        subtitle={headerSubtitle}
        accessory={headerAccessory}
        loading={modelsLoading}
      />

      {description ? (
        <p className="max-w-[66ch] text-instrument text-muted">{description}</p>
      ) : null}

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-meta"
          aria-hidden
        />
        <input
          type="search"
          aria-label={searchAriaLabel}
          className={cn(inputClass, "pl-9")}
          placeholder={searchPlaceholder}
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <PickerControls
        connectionOptions={connectionOptions}
        connectionFilter={connectionFilter}
        onConnectionFilterChange={onConnectionFilterChange}
        sortOptions={sortOptions}
        sortValue={sortValue}
        onSortChange={onSortChange}
        controlsLeading={controlsLeading}
      />

      <SelectionStates modelsError={modelsError} onRetry={onRetry} unavailable={unavailable} />

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        <ModelList
          models={models}
          visibleModels={visibleModels}
          modelsLoading={modelsLoading}
          searchTerm={searchTerm}
          noun={noun}
          emptyLabel={emptyLabel}
          groupByConnection={groupByConnection}
          renderModel={renderModel}
        />
      </div>
    </div>
  );
}
