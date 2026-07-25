"use client";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

import type { Collection } from "@/lib/types";
import type { ReactNode } from "react";

interface CollectionToolsCardProps {
  collections: Collection[];
  selectedCollectionIds: string[];
  onToggle: (collectionId: string) => void;
  onClear: () => void;
  collectionsLoading: boolean;
  collectionsError: string | null;
}

type ToolOptionProps = {
  selected: boolean;
  onToggle: () => void;
  children: ReactNode;
};

function ToolOption({ selected, onToggle, children }: ToolOptionProps) {
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

/** Which collections expose retrieval tools to the model on the next turn. */
export const CollectionToolsCard = ({
  collections,
  selectedCollectionIds,
  onToggle,
  onClear,
  collectionsLoading,
  collectionsError,
}: CollectionToolsCardProps) => {
  if (collectionsLoading) {
    return <p className="text-ui text-muted">Loading collections…</p>;
  }

  if (collectionsError) {
    return <p className="text-ui text-data-neg">{collectionsError}</p>;
  }

  const noneSelected = selectedCollectionIds.length === 0;
  const collectionMap = new Map(collections.map((collection) => [collection.id, collection]));

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-ui text-primary">
          {noneSelected
            ? "No collections enabled"
            : `${selectedCollectionIds.length} collection${
                selectedCollectionIds.length === 1 ? "" : "s"
              } enabled`}
        </p>
        {!noneSelected && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear all
          </Button>
        )}
      </div>

      {!noneSelected && (
        <div className="flex flex-wrap gap-1">
          {selectedCollectionIds.map((collectionId) => (
            <Chip key={collectionId} tone="retrieve">
              {collectionMap.get(collectionId)?.name ?? "Unknown"}
            </Chip>
          ))}
        </div>
      )}

      <div className="space-y-0.5">
        <ToolOption selected={noneSelected} onToggle={onClear}>
          No collections
        </ToolOption>
        {collections.length === 0 ? (
          <p className="px-2 py-1.5 text-ui text-muted">No collections available.</p>
        ) : (
          collections.map((collection) => (
            <ToolOption
              key={collection.id}
              selected={selectedCollectionIds.includes(collection.id)}
              onToggle={() => onToggle(collection.id)}
            >
              {collection.name}
            </ToolOption>
          ))
        )}
      </div>
    </div>
  );
};
