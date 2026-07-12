"use client";

import { Filter, PanelLeftClose, PlusCircle, Trash2 } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { chipClass } from "@/components/chat-studio/lib/chat-constants";
import { Button } from "@/components/ui/button";
import { parseApiDate } from "@/lib/datetime";
import { cn, timeAgo } from "@/lib/utils";

import type { ChatSession, Collection } from "@/lib/types";

/** Inactive state shared by the collection-filter rows. */
const FILTER_ROW_INACTIVE = "border-hairline bg-surface text-body hover:border-strong";

interface HistoryPanelProps {
  collections: Collection[];
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  filterCollectionIds: string[];
  filterIncludeUnassigned: boolean;
  onFilterChange: (collectionIds: string[], includeUnassigned: boolean) => void;
  onDelete: (sessionId: string) => void;
  deletingSessionId: string | null;
  onClose: () => void;
}

const HistoryPanelComponent = ({
  collections,
  sessions,
  selectedSessionId,
  onSelect,
  onNewChat,
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
      <div className="border-b border-hairline px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-meta">History</p>
            <h2 className="text-xl font-semibold text-primary">Chat sessions</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-hairline p-0 text-muted"
            onClick={onClose}
            aria-label="Close history"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 flex items-center">
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              className={cn(
                "flex h-9 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-[11px] uppercase tracking-[0.3em] transition",
                filterActive
                  ? "border-accent-violet/60 bg-accent-violet/10 text-primary"
                  : "border-hairline text-body hover:border-strong hover:text-primary",
              )}
              onClick={() => setFilterOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={filterOpen}
            >
              <Filter className="h-3.5 w-3.5" />
              {filterActive ? `${filterCount}` : "Filter"}
            </button>
            {filterOpen && (
              <div className="absolute left-0 z-30 mt-2 w-72 rounded-2xl border border-hairline bg-canvas-raised p-3 text-xs text-body shadow-elevation-2">
                {filterActive && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {filterCollectionIds.map((collectionId) => (
                      <span key={collectionId} className={chipClass}>
                        {collectionMap.get(collectionId)?.name ?? "Unknown"}
                      </span>
                    ))}
                    {filterIncludeUnassigned && <span className={chipClass}>No collections</span>}
                  </div>
                )}
                <div className="space-y-2">
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left",
                      filterIncludeUnassigned
                        ? "border-accent-cyan/50 bg-accent-cyan/10 text-primary"
                        : FILTER_ROW_INACTIVE,
                    )}
                    onClick={toggleUnassigned}
                  >
                    <span>No collections</span>
                    <input type="checkbox" readOnly checked={filterIncludeUnassigned} />
                  </button>
                  {collections.length === 0 ? (
                    <p className="text-[11px] text-muted">No collections available.</p>
                  ) : (
                    collections.map((collection) => {
                      const selected = filterCollectionIds.includes(collection.id);
                      return (
                        <button
                          key={collection.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left",
                            selected
                              ? "border-accent-violet/60 bg-accent-violet/10 text-primary"
                              : FILTER_ROW_INACTIVE,
                          )}
                          onClick={() => toggleFilterCollection(collection.id)}
                        >
                          <span>{collection.name}</span>
                          <input type="checkbox" readOnly checked={selected} />
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
                  <span className="text-[11px] text-meta">
                    {filterActive ? "Filters active" : "Showing all"}
                  </span>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted hover:text-primary"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="border-b border-hairline px-5 py-3">
        <Button
          variant="secondary"
          className="flex h-10 w-full items-center justify-center gap-2"
          onClick={onNewChat}
        >
          <PlusCircle className="h-4 w-4" />
          <span>New chat</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted">No chats yet — start one below.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => {
              const isSelected = selectedSessionId === session.id;
              const toolCollections = session.tool_collection_ids || [];
              const toolLabelEntries =
                toolCollections.length > 0
                  ? toolCollections.map((collectionId) => ({
                      key: collectionId,
                      label: collectionMap.get(collectionId)?.name ?? "Unknown collection",
                    }))
                  : [{ key: "none", label: "No collections" }];
              return (
                <div
                  key={session.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-2xl border px-2 py-2 text-sm transition",
                    isSelected
                      ? "border-accent-violet bg-accent-violet/10 text-primary"
                      : FILTER_ROW_INACTIVE,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(session.id)}
                    className={cn(
                      "flex-1 rounded-xl px-2 py-1 text-left",
                      isSelected ? "text-primary" : "text-body group-hover:text-primary",
                    )}
                  >
                    <p className="text-base font-semibold">{formatSessionTitle(session)}</p>
                    <p
                      className={cn(
                        "text-xs",
                        isSelected ? "text-body" : "text-muted group-hover:text-body",
                      )}
                    >
                      {session.chat_model} • {timeAgo(session.updated_at)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {toolLabelEntries.map((entry) => (
                        <span key={`${session.id}-${entry.key}`} className={chipClass}>
                          {entry.label}
                        </span>
                      ))}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(session.id)}
                    disabled={deletingSessionId === session.id}
                    title="Delete chat"
                    aria-label={`Delete ${session.title}`}
                    className={cn(
                      "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-muted transition hover:text-data-neg disabled:cursor-not-allowed disabled:opacity-50",
                      isSelected
                        ? "border-strong hover:border-data-neg/60"
                        : "border-hairline hover:border-data-neg/60",
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const HistoryPanel = memo(HistoryPanelComponent);
