"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { UnreachableProviderNotice } from "@/components/connections/UnreachableProviderNotice";
import { useModelShortlist } from "@/components/models/hooks/use-model-shortlist";
import { modelKey } from "@/components/models/model-catalog-filter";
import { ModelBrowserOverlay } from "@/components/models/ModelBrowserOverlay";
import { ModelPickerAllTab } from "@/components/models/ModelPickerAllTab";
import {
  ModelPickerHeader,
  UnavailableSelectionNotice,
} from "@/components/models/ModelPickerHeader";
import { ModelRow } from "@/components/models/ModelRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ShortlistedModel } from "@/components/models/hooks/use-model-shortlist";
import type { ModelSortDef } from "@/components/models/model-catalog-filter";
import type { ModelAnnotation } from "@/components/models/ModelCatalogList";
import type { UnavailableSelection } from "@/components/models/ModelPickerHeader";
import type { CatalogModel, ConnectionCatalogError, ShortlistKind } from "@/lib/types";
import type { ReactNode } from "react";

type PickerTab = "pinned" | "recent" | "all";

export interface ModelPickerCopy {
  /** Shown in the header when nothing is selected yet. */
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  /** Says something the UI cannot show; omit when the design already says it. */
  description?: string;
}

export interface ModelPickerInlineProps {
  kind: ShortlistKind;
  models: CatalogModel[];
  selectedConnectionId?: string | null;
  selectedModelId?: string | null;
  onSelectModel: (model: CatalogModel) => void;
  loading: boolean;
  /** A failure of the whole catalog request — never one provider's. */
  modelsError?: string | null;
  /** Connections that failed to list models, stated in place of their rows. */
  connectionErrors?: ConnectionCatalogError[];
  onRetry?: () => void;
  copy: ModelPickerCopy;
  headerAccessory?: ReactNode;
  /** Extra control on the All tab's control row (the embedding dimension readout). */
  controlsLeading?: ReactNode;
  sortOptions?: ModelSortDef[];
  renderTrailing?: (model: CatalogModel) => ReactNode;
  /** Surface-specific marks on a row — a recommendation, or a caveat. */
  annotate?: (model: CatalogModel) => ModelAnnotation | null;
  /** Model id floated to the top of the All tab. */
  prioritizedModelId?: string | null;
  unavailable?: UnavailableSelection | null;
}

const TAB_LABELS: Array<{ id: PickerTab; label: string }> = [
  { id: "pinned", label: "Pinned" },
  { id: "recent", label: "Recent" },
  { id: "all", label: "All" },
];

/**
 * The failures that explain a shortlist entry the catalog could not resolve.
 *
 * A pinned model whose provider is down drops out of its section, so without
 * this the user's own pin is simply missing and nothing says why. Failures of
 * connections the shortlist never names stay out of the way until the All tab.
 */
function shortlistFailures(
  entries: ShortlistedModel[],
  connectionErrors: ConnectionCatalogError[] | undefined,
): ConnectionCatalogError[] {
  if (!connectionErrors?.length) return [];
  const missing = new Set(
    entries.filter((entry) => entry.model === null).map((entry) => entry.entry.connection_id),
  );
  return connectionErrors.filter((error) => missing.has(error.connection_id));
}

/** Tabs fall through to whichever section has something in it. */
function initialTab(pinnedCount: number, recentCount: number): PickerTab {
  if (pinnedCount > 0) return "pinned";
  if (recentCount > 0) return "recent";
  return "all";
}

function ShortlistSection({
  entries,
  selectedKey,
  onSelect,
  isPinned,
  onTogglePin,
  renderTrailing,
  annotate,
  emptyHint,
  failures,
}: {
  entries: ShortlistedModel[];
  selectedKey: string | null;
  onSelect: (model: CatalogModel) => void;
  isPinned: (model: CatalogModel) => boolean;
  onTogglePin: (model: CatalogModel) => void;
  renderTrailing?: (model: CatalogModel) => ReactNode;
  annotate?: (model: CatalogModel) => ModelAnnotation | null;
  emptyHint: string;
  failures: ConnectionCatalogError[];
}) {
  const resolved = entries.filter((entry) => entry.model !== null);
  const notices = failures.map((error) => (
    <UnreachableProviderNotice key={error.connection_id} error={error} />
  ));
  if (resolved.length === 0) {
    return (
      <div className="space-y-2">
        {notices}
        <p className="px-1 py-2 text-ui text-muted">{emptyHint}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {notices}
      {resolved.map(({ entry, model }) => {
        const catalogModel = model as CatalogModel;
        return (
          <ModelRow
            key={modelKey(entry.connection_id, entry.model_id)}
            model={catalogModel}
            selected={selectedKey === modelKey(entry.connection_id, entry.model_id)}
            onSelect={onSelect}
            pinned={isPinned(catalogModel)}
            onTogglePin={onTogglePin}
            trailing={renderTrailing?.(catalogModel)}
            badge={annotate?.(catalogModel)?.badge}
            note={annotate?.(catalogModel)?.note}
          />
        );
      })}
    </div>
  );
}

/**
 * The inline model picker: the selected model, then the models this user
 * actually works with, with the full catalog one tab (or one overlay) away.
 *
 * The tabs fall through — Pinned when there are pins, else Recent, else All —
 * so a new account with neither lands on a searchable catalog rather than an
 * empty pane. The All tab keeps search, the provider filter, and sort so
 * nothing the previous picker could do is lost; they are simply no longer the
 * first thing a returning user has to operate.
 */
export function ModelPickerInline({
  kind,
  models,
  selectedConnectionId,
  selectedModelId,
  onSelectModel,
  loading,
  modelsError,
  connectionErrors,
  onRetry,
  copy,
  headerAccessory,
  controlsLeading,
  sortOptions,
  renderTrailing,
  annotate,
  prioritizedModelId,
  unavailable,
}: ModelPickerInlineProps) {
  const shortlist = useModelShortlist(kind, models);
  const [tab, setTab] = useState<PickerTab | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);

  const selectedKey =
    selectedConnectionId && selectedModelId
      ? modelKey(selectedConnectionId, selectedModelId)
      : null;
  const currentModel =
    models.find((model) => modelKey(model.connection_id, model.id) === selectedKey) ?? null;

  const activeTab = tab ?? initialTab(shortlist.pinned.length, shortlist.recent.length);

  const handleSelect = (model: CatalogModel) => {
    onSelectModel(model);
    shortlist.recordUse(model);
  };

  return (
    <div className="space-y-3">
      {/* `loading` is scoped to an empty picker: a spinner over a list the user
          is already reading reports a background refresh as a wait. */}
      <ModelPickerHeader
        model={currentModel}
        placeholder={copy.placeholder}
        accessory={headerAccessory}
        loading={loading && models.length === 0}
      />

      {copy.description ? (
        <p className="max-w-[66ch] text-instrument text-muted">{copy.description}</p>
      ) : null}

      {modelsError ? (
        <div className="flex items-center justify-between gap-3 rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2">
          <p className="text-ui text-data-neg">{modelsError}</p>
          {onRetry ? (
            <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {shortlist.error ? <p className="text-ui text-data-neg">{shortlist.error}</p> : null}
      {unavailable ? <UnavailableSelectionNotice unavailable={unavailable} /> : null}

      <div
        role="group"
        aria-label="Model list"
        className="flex items-center gap-1 rounded-control bg-surface p-1"
      >
        {TAB_LABELS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={activeTab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              "flex-1 rounded-control px-2 py-1 text-instrument font-medium transition-colors duration-80 ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
              activeTab === entry.id
                ? "bg-accent-violet/15 text-primary"
                : "text-muted hover:text-body",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {activeTab === "pinned" ? (
        <ShortlistSection
          entries={shortlist.pinned}
          selectedKey={selectedKey}
          onSelect={handleSelect}
          isPinned={shortlist.isPinned}
          onTogglePin={shortlist.togglePin}
          renderTrailing={renderTrailing}
          annotate={annotate}
          emptyHint="Star a model to pin it here."
          failures={shortlistFailures(shortlist.pinned, connectionErrors)}
        />
      ) : null}

      {activeTab === "recent" ? (
        <ShortlistSection
          entries={shortlist.recent}
          selectedKey={selectedKey}
          onSelect={handleSelect}
          isPinned={shortlist.isPinned}
          onTogglePin={shortlist.togglePin}
          renderTrailing={renderTrailing}
          annotate={annotate}
          emptyHint="Models you select appear here."
          failures={shortlistFailures(shortlist.recent, connectionErrors)}
        />
      ) : null}

      {activeTab === "all" ? (
        <ModelPickerAllTab
          models={models}
          selectedKey={selectedKey}
          onSelect={handleSelect}
          isPinned={shortlist.isPinned}
          onTogglePin={shortlist.togglePin}
          loading={loading}
          searchPlaceholder={copy.searchPlaceholder}
          emptyLabel={copy.emptyLabel}
          sortOptions={sortOptions}
          controlsLeading={controlsLeading}
          renderTrailing={renderTrailing}
          annotate={annotate}
          prioritizedModelId={prioritizedModelId}
          connectionErrors={connectionErrors}
        />
      ) : null}

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => setBrowserOpen(true)}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        Open model browser
      </Button>

      {browserOpen ? (
        <ModelBrowserOverlay
          models={models}
          selectedKey={selectedKey}
          onSelect={(model) => {
            handleSelect(model);
            setBrowserOpen(false);
          }}
          onClose={() => setBrowserOpen(false)}
          isPinned={shortlist.isPinned}
          onTogglePin={shortlist.togglePin}
          loading={loading}
          searchPlaceholder={copy.searchPlaceholder}
          emptyLabel={copy.emptyLabel}
          sortOptions={sortOptions}
          renderTrailing={renderTrailing}
          annotate={annotate}
          connectionErrors={connectionErrors}
        />
      ) : null}
    </div>
  );
}
