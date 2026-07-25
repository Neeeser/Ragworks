"use client";

import { Check, Filter, PanelLeftClose, Trash2 } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { cn, timeAgo } from "@/lib/utils";

import type { ChatSession, Collection } from "@/lib/types";
import type { ReactNode } from "react";

interface HistoryPanelProps {
  collections: Collection[];
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  filterCollectionIds: string[];
  filterIncludeUnassigned: boolean;
  onFilterChange: (collectionIds: string[], includeUnassigned: boolean) => void;
  onDelete: (sessionId: string) => void;
  deletingSessionId: string | null;
  onClose: () => void;
}

type FilterOptionProps = {
  selected: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/** One toggleable line in the filter menu; the tick carries the state. */
function FilterOption({ selected, onToggle, children }: FilterOptionProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-ui",
        "transition-colors duration-80 ease-standard focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
        selected ? "bg-accent-violet/12 text-primary" : "text-body hover:bg-surface-strong",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent-violet" aria-hidden /> : null}
    </button>
  );
}

/**
 * The session list.
 *
 * A session's row carries what distinguishes it from its neighbours: its title,
 * the model it ran on, when it was last touched, and which collections its tools
 * were bound to. A session with no collections shows no chips — the absence is
 * the fact, and a "None" pill on every such row would say nothing.
 */
const HistoryPanelComponent = ({
  collections,
  sessions,
  selectedSessionId,
  onSelect,
  filterCollectionIds,
  filterIncludeUnassigned,
  onFilterChange,
  onDelete,
  deletingSessionId,
  onClose,
}: HistoryPanelProps) => {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const collectionMap = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection])),
    [collections],
  );
  const filterActive = filterCollectionIds.length > 0 || filterIncludeUnassigned;
  const filterCount = filterCollectionIds.length + (filterIncludeUnassigned ? 1 : 0);

  useEffect(() => {
    if (!filterOpen) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [filterOpen]);

  const toggleFilterCollection = (collectionId: string) => {
    const exists = filterCollectionIds.includes(collectionId);
    const next = exists
      ? filterCollectionIds.filter((id) => id !== collectionId)
      : [...filterCollectionIds, collectionId];
    onFilterChange(next, filterIncludeUnassigned);
  };

  const toggleUnassigned = () => {
    onFilterChange(filterCollectionIds, !filterIncludeUnassigned);
  };

  const formatSessionTitle = (session: ChatSession) => {
    const defaultTitlePattern = /^Chat\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?$/i;
    if (!defaultTitlePattern.test(session.title)) {
      return session.title;
    }
    const createdAt = parseApiDate(session.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      return session.title;
    }
    const timeLabel = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(createdAt);
    return `Chat ${timeLabel}`;
  };

  const clearFilters = () => {
    onFilterChange([], false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <InstrumentLabel>Chats</InstrumentLabel>
        <span className="font-mono text-instrument tabular-nums text-meta">{sessions.length}</span>
        <div className="relative ml-auto" ref={filterRef}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFilterOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={filterOpen}
            className={filterActive ? "text-accent-violet" : undefined}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
            {filterActive ? `${filterCount}` : "Filter"}
          </Button>
          {filterOpen && (
            // Opens toward the card's interior: this row is the pane's top-left
            // corner and the card clips its own overflow.
            <div className="console-flyout card-surface absolute left-0 z-30 mt-1 w-64 bg-canvas-raised p-2 shadow-elevation-2">
              <div className="max-h-64 space-y-0.5 overflow-y-auto">
                <FilterOption selected={filterIncludeUnassigned} onToggle={toggleUnassigned}>
                  No collections
                </FilterOption>
                {collections.length === 0 ? (
                  <p className="px-2 py-1.5 text-ui text-muted">No collections available.</p>
                ) : (
                  collections.map((collection) => (
                    <FilterOption
                      key={collection.id}
                      selected={filterCollectionIds.includes(collection.id)}
                      onToggle={() => toggleFilterCollection(collection.id)}
                    >
                      {collection.name}
                    </FilterOption>
                  ))
                )}
              </div>
              {filterActive ? (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-hairline pt-2">
                  {filterCollectionIds.map((collectionId) => (
                    <Chip key={collectionId} tone="retrieve">
                      {collectionMap.get(collectionId)?.name ?? "Unknown"}
                    </Chip>
                  ))}
                  {filterIncludeUnassigned && <Chip>No collections</Chip>}
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-hairline pt-2">
                <InstrumentLabel className="text-meta">
                  {filterActive ? "Filters active" : "Showing all"}
                </InstrumentLabel>
                <Button size="sm" variant="ghost" onClick={clearFilters}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </div>
        <Tooltip content="Hide chat history" side="bottom">
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close history">
            <PanelLeftClose className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="p-8 text-center text-ui text-muted">No chats yet.</p>
        ) : (
          sessions.map((session) => {
            const isSelected = selectedSessionId === session.id;
            const toolCollections = session.tool_collection_ids ?? [];
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex items-start gap-1 border-b border-hairline last:border-b-0",
                  isSelected && "bg-accent-violet/12",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  aria-current={isSelected ? "true" : undefined}
                  className={cn(
                    "min-w-0 flex-1 px-3 py-2 text-left",
                    "transition-colors duration-80 ease-standard focus-visible:outline-none",
                    "focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
                    isSelected ? "text-primary" : "hover:bg-surface-strong",
                  )}
                >
                  <p
                    className={cn(
                      "truncate text-ui font-medium",
                      isSelected ? "text-primary" : "text-body group-hover:text-primary",
                    )}
                  >
                    {formatSessionTitle(session)}
                  </p>
                  <p className="mt-0.5 flex items-baseline gap-2 text-instrument text-meta">
                    <span className="min-w-0 truncate font-mono">{session.chat_model}</span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {timeAgo(session.updated_at)}
                    </span>
                  </p>
                  {toolCollections.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {toolCollections.map((collectionId) => (
                        <Chip key={`${session.id}-${collectionId}`} tone="retrieve">
                          {collectionMap.get(collectionId)?.name ?? "Unknown collection"}
                        </Chip>
                      ))}
                    </span>
                  )}
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(session.id)}
                  disabled={deletingSessionId === session.id}
                  aria-label={`Delete ${session.title}`}
                  className="mt-1 mr-1 shrink-0 hover:text-data-neg"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export const HistoryPanel = memo(HistoryPanelComponent);
