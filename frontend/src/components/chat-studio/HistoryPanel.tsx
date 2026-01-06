"use client";

import { Filter, PanelLeftClose, PlusCircle, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";

import type { ChatSession, Collection } from "@/lib/types";

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

export const HistoryPanel = ({
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
  const chipClass =
    "rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-slate-300";

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

  const clearFilters = () => {
    onFilterChange([], false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">History</p>
          <h2 className="text-xl font-semibold text-white">Chat sessions</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              className={cn(
                "flex h-9 items-center gap-2 rounded-full border px-3 text-[11px] uppercase tracking-[0.3em] transition",
                filterActive
                  ? "border-violet-400/60 bg-violet-500/10 text-white"
                  : "border-white/10 text-slate-300 hover:border-white/30 hover:text-white",
              )}
              onClick={() => setFilterOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={filterOpen}
            >
              <Filter className="h-3.5 w-3.5" />
              {filterActive ? `Filter (${filterCount})` : "Filter"}
            </button>
            {filterOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-3 text-xs text-slate-200 shadow-xl">
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
                        ? "border-cyan-400/50 bg-cyan-500/10 text-white"
                        : "border-white/10 bg-white/5 text-slate-300 hover:border-white/30",
                    )}
                    onClick={toggleUnassigned}
                  >
                    <span>No collections</span>
                    <input type="checkbox" readOnly checked={filterIncludeUnassigned} />
                  </button>
                  {collections.length === 0 ? (
                    <p className="text-[11px] text-slate-400">No collections available.</p>
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
                              ? "border-violet-400/60 bg-violet-500/10 text-white"
                              : "border-white/10 bg-white/5 text-slate-300 hover:border-white/30",
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
                <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
                  <span className="text-[11px] text-slate-500">
                    {filterActive ? "Filters active" : "Showing all"}
                  </span>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-[11px] uppercase tracking-[0.3em] text-slate-300 hover:text-white"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 p-0 text-slate-300"
            onClick={onClose}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="border-b border-white/5 px-5 py-3">
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
          <p className="text-sm text-slate-400">No chats yet — start one below.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => {
              const isSelected = selectedSessionId === session.id;
              const toolCollections = session.tool_collection_ids || [];
              const toolLabels =
                toolCollections.length > 0
                  ? toolCollections.map(
                      (collectionId) =>
                        collectionMap.get(collectionId)?.name ?? "Unknown collection",
                    )
                  : ["No collections"];
              return (
                <div
                  key={session.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-2xl border px-2 py-2 text-sm transition",
                    isSelected
                      ? "border-violet-400 bg-violet-500/10 text-white"
                      : "border-white/5 bg-white/5 text-slate-300 hover:border-white/20",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(session.id)}
                    className={cn(
                      "flex-1 rounded-xl px-2 py-1 text-left",
                      isSelected ? "text-white" : "text-slate-300 group-hover:text-white",
                    )}
                  >
                    <p className="text-base font-semibold">{session.title}</p>
                    <p
                      className={cn(
                        "text-xs",
                        isSelected ? "text-slate-300" : "text-slate-400 group-hover:text-slate-200",
                      )}
                    >
                      {session.chat_model} • {timeAgo(session.updated_at)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {toolLabels.map((label) => (
                        <span key={`${session.id}-${label}`} className={chipClass}>
                          {label}
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
                      "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-slate-400 transition hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50",
                      isSelected
                        ? "border-white/20 hover:border-rose-300/60"
                        : "border-white/10 hover:border-rose-300/60",
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
