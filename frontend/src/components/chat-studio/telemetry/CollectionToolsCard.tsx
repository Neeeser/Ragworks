"use client";

import { chipClass } from "@/components/chat-studio/lib/chat-constants";
import { cn } from "@/lib/utils";

import type { Collection } from "@/lib/types";

interface CollectionToolsCardProps {
  collections: Collection[];
  selectedCollectionIds: string[];
  onToggle: (collectionId: string) => void;
  onClear: () => void;
  collectionsLoading: boolean;
  collectionsError: string | null;
}

export const CollectionToolsCard = ({
  collections,
  selectedCollectionIds,
  onToggle,
  onClear,
  collectionsLoading,
  collectionsError,
}: CollectionToolsCardProps) => {
  if (collectionsLoading) {
    return <p className="text-sm text-slate-400">Loading collections…</p>;
  }

  if (collectionsError) {
    return <p className="text-sm text-rose-300">{collectionsError}</p>;
  }

  const noneSelected = selectedCollectionIds.length === 0;
  const collectionMap = new Map(collections.map((collection) => [collection.id, collection]));
  const selectedEntries = selectedCollectionIds.map((collectionId) => ({
    id: collectionId,
    label: collectionMap.get(collectionId)?.name ?? "Unknown",
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-white">
            {noneSelected
              ? "No collections enabled"
              : `${selectedCollectionIds.length} collection${
                  selectedCollectionIds.length === 1 ? "" : "s"
                } enabled`}
          </p>
          <p className="text-xs text-slate-400">
            Select one or more collections to expose retrieval tools to the model.
          </p>
        </div>
        {!noneSelected && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] uppercase tracking-[0.3em] text-slate-300 hover:text-white"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {selectedEntries.length > 0 ? (
          selectedEntries.map((entry) => (
            <span key={entry.id} className={chipClass}>
              {entry.label}
            </span>
          ))
        ) : (
          <span className={chipClass}>No collections</span>
        )}
      </div>

      <div className="space-y-2">
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left",
            noneSelected
              ? "border-cyan-400/50 bg-cyan-500/10 text-white"
              : "border-white/10 bg-white/5 text-slate-300 hover:border-white/30",
          )}
          onClick={onClear}
        >
          <span>No collections</span>
          <input type="checkbox" readOnly checked={noneSelected} />
        </button>
        {collections.length === 0 ? (
          <p className="text-[11px] text-slate-400">No collections available.</p>
        ) : (
          collections.map((collection) => {
            const selected = selectedCollectionIds.includes(collection.id);
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
                onClick={() => onToggle(collection.id)}
              >
                <span>{collection.name}</span>
                <input type="checkbox" readOnly checked={selected} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
