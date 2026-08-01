"use client";

import { useMemo, useState } from "react";

import { groupModelsByConnection, modelKey } from "@/components/models/model-catalog-filter";
import { ModelRow } from "@/components/models/ModelRow";
import { ProviderDrawer, SMALL_PROVIDER_LIMIT } from "@/components/models/ProviderDrawer";
import { Skeleton } from "@/components/ui/skeleton";

import type { ConnectionGroup } from "@/components/models/model-catalog-filter";
import type { CatalogModel } from "@/lib/types";
import type { ReactNode } from "react";

/** Per-model annotations a surface adds on top of the catalog's own facts. */
export interface ModelAnnotation {
  /** Short marker beside the name, e.g. "Suggested". */
  badge?: ReactNode;
  /** A caveat under the row — why this model may not suit the current target. */
  note?: ReactNode;
}

export interface ModelCatalogListProps {
  /** Models after search, provider filter, and capability filters. */
  models: CatalogModel[];
  /** The unfiltered catalog, so a drawer head can say "4 of 312". */
  allModels: CatalogModel[];
  selectedKey: string | null;
  onSelect: (model: CatalogModel) => void;
  isPinned?: (model: CatalogModel) => boolean;
  onTogglePin?: (model: CatalogModel) => void;
  /** True while a search term is narrowing the list — drawers auto-expand. */
  searching: boolean;
  loading?: boolean;
  emptyLabel: string;
  /** Trailing datum per row (context length, dimension). */
  renderTrailing?: (model: CatalogModel) => ReactNode;
  /** Surface-specific marks on a row — a recommendation, or a caveat. */
  annotate?: (model: CatalogModel) => ModelAnnotation | null;
}

/** Provider ids the user has explicitly opened or closed, overriding the default. */
type DrawerOverrides = Record<string, boolean>;

function defaultOpen(group: ConnectionGroup, groupCount: number, searching: boolean): boolean {
  // While searching, every drawer holding a match opens: a match hidden behind
  // a collapsed head reads as "no results".
  if (searching) {
    return true;
  }
  // A provider small enough to read whole, or the only one connected, starts
  // open — collapsing it would cost a click and hide nothing.
  return groupCount === 1 || group.models.length <= SMALL_PROVIDER_LIMIT;
}

/**
 * The catalog grouped into per-provider drawers.
 *
 * Shared by the inline picker's All tab and the browser overlay's list pane so
 * the two read as one surface. Providers with no match under the current
 * search collapse into a single line rather than disappearing, because a
 * provider silently missing from the list looks like a broken connection.
 */
export function ModelCatalogList({
  models,
  allModels,
  selectedKey,
  onSelect,
  isPinned,
  onTogglePin,
  searching,
  loading = false,
  emptyLabel,
  renderTrailing,
  annotate,
}: ModelCatalogListProps) {
  const [overrides, setOverrides] = useState<DrawerOverrides>({});

  const groups = useMemo(() => groupModelsByConnection(models), [models]);
  const totals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of allModels) {
      counts.set(model.connection_id, (counts.get(model.connection_id) ?? 0) + 1);
    }
    return counts;
  }, [allModels]);

  const emptyConnections = useMemo(() => {
    const shown = new Set(groups.map((group) => group.connectionId));
    const labels = new Map<string, string>();
    for (const model of allModels) {
      if (!shown.has(model.connection_id)) {
        labels.set(model.connection_id, model.connection_label);
      }
    }
    return [...labels.values()];
  }, [groups, allModels]);

  if (loading && allModels.length === 0) {
    return (
      <div aria-busy className="space-y-2">
        {Array.from({ length: 4 }, (_, row) => (
          <Skeleton key={row} className="h-9 w-full" />
        ))}
        <span className="sr-only">Loading models</span>
      </div>
    );
  }

  if (groups.length === 0) {
    return <p className="px-1 py-2 text-ui text-muted">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const open = overrides[group.connectionId] ?? defaultOpen(group, groups.length, searching);
        return (
          <ProviderDrawer
            key={group.connectionId}
            connectionLabel={group.connectionLabel}
            providerType={group.providerType}
            shownCount={group.models.length}
            totalCount={totals.get(group.connectionId) ?? group.models.length}
            open={open}
            onToggle={() =>
              setOverrides((current) => ({ ...current, [group.connectionId]: !open }))
            }
          >
            {group.models.map((model) => (
              <ModelRow
                key={modelKey(model.connection_id, model.id)}
                model={model}
                selected={selectedKey === modelKey(model.connection_id, model.id)}
                onSelect={onSelect}
                pinned={isPinned?.(model) ?? false}
                onTogglePin={onTogglePin}
                showProviderIcon={false}
                trailing={renderTrailing?.(model)}
                badge={annotate?.(model)?.badge}
                note={annotate?.(model)?.note}
              />
            ))}
          </ProviderDrawer>
        );
      })}
      {emptyConnections.length > 0 ? (
        <p className="px-1 text-instrument text-meta">
          No matches in {emptyConnections.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
