"use client";

import { Files, FolderKanban, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  buildCollectionStatItems,
  CollectionStatCard,
} from "@/components/collections/CollectionStats";
import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { Collection, CollectionStats } from "@/lib/types";

type CollectionsListProps = {
  collections: Collection[];
  statsById: Record<string, CollectionStats | undefined>;
  onDeleteRequest: (collection: Collection) => void;
};

const focusRingClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function CollectionsList({ collections, statsById, onDeleteRequest }: CollectionsListProps) {
  const router = useRouter();

  if (collections.length === 0) {
    return (
      <GlassCard className="rounded-3xl border border-hairline p-6 text-sm text-body">
        No collections yet. Create one to start indexing documents.
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {collections.map((collection) => {
        const stats = statsById[collection.id];
        const statItems = buildCollectionStatItems(collection, stats);
        return (
          <div
            key={collection.id}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/collections/${collection.id}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                router.push(`/collections/${collection.id}`);
              }
            }}
            className={cn(
              "group rounded-3xl border border-hairline bg-surface p-5 text-left transition",
              "hover:border-strong hover:bg-surface-strong",
              focusRingClass,
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.35em] text-muted">
                  <FolderKanban className="h-3.5 w-3.5 text-accent-violet" />
                  Collection
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-primary">{collection.name}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {collection.description?.trim() || "No description yet."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    router.push(`/collections/${collection.id}/files`);
                  }}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm",
                    "border-hairline text-body transition hover:border-strong hover:text-primary",
                    focusRingClass,
                  )}
                  aria-label={`Browse files in ${collection.name}`}
                >
                  <Files className="h-4 w-4" aria-hidden />
                  Files
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteRequest(collection);
                  }}
                  className={cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-full border",
                    "border-hairline text-muted transition hover:border-data-neg/60 hover:text-data-neg",
                    focusRingClass,
                  )}
                  aria-label={`Delete ${collection.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {statItems.map((item) => (
                <div
                  key={`${collection.id}-${item.label}`}
                  className="rounded-2xl border border-hairline bg-surface px-3 py-3 text-sm"
                >
                  <CollectionStatCard
                    item={item}
                    valueClassName="mt-2 text-base font-semibold text-primary"
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
