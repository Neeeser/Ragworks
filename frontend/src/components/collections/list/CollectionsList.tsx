"use client";

import { Files, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DATA_ROW_ACTIONS_SLOT, DataRow, DataRowHeader } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Skeleton } from "@/components/ui/skeleton";
import { parseApiDate } from "@/lib/datetime";
import { formatTimeAgoCompact } from "@/lib/format";

import type { Collection, CollectionStats } from "@/lib/types";

type CollectionsListProps = {
  collections: Collection[];
  statsById: Record<string, CollectionStats | undefined>;
  onDeleteRequest: (collection: Collection) => void;
  onCreateRequest: () => void;
  loading?: boolean;
};

/**
 * Column widths shared by the header and every row, so numbers line up in a
 * readable column instead of each row measuring its own content.
 */
const COL = {
  docs: "w-16 text-right",
  chunks: "w-20 text-right",
  updated: "w-20 text-right",
};

function ColumnHeader() {
  return (
    <DataRowHeader
      title="Name"
      columns={[
        <InstrumentLabel key="docs" className={COL.docs}>
          Docs
        </InstrumentLabel>,
        <InstrumentLabel key="chunks" className={COL.chunks}>
          Chunks
        </InstrumentLabel>,
        <InstrumentLabel key="updated" className={COL.updated}>
          Updated
        </InstrumentLabel>,
      ]}
    />
  );
}

function LoadingRows() {
  return (
    <div aria-busy>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center border-b border-hairline">
          <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2">
            <Skeleton className="h-2 max-w-48 flex-1" />
            <Skeleton className={`h-2 ${COL.docs}`} />
            <Skeleton className={`h-2 ${COL.chunks}`} />
            <Skeleton className={`h-2 ${COL.updated}`} />
          </div>
          <span className={DATA_ROW_ACTIONS_SLOT} aria-hidden />
        </div>
      ))}
      <span className="sr-only">Loading collections</span>
    </div>
  );
}

/**
 * One row per collection.
 *
 * Previously one 190px card each, carrying a `COLLECTION` eyebrow above every
 * entry in a list of collections, a "No description yet." placeholder, and five
 * stats in five nested sub-cards — four levels of container for five numbers.
 * Average latency and last-used moved to the collection's own page, where they
 * belong: this page's job is to list collections.
 */
export function CollectionsList({
  collections,
  statsById,
  onDeleteRequest,
  onCreateRequest,
  loading = false,
}: CollectionsListProps) {
  const router = useRouter();

  if (loading) {
    return (
      <>
        <ColumnHeader />
        <LoadingRows />
      </>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-ui text-muted">No collections yet.</p>
        <Button size="sm" className="mt-3" onClick={onCreateRequest}>
          Create collection
        </Button>
      </div>
    );
  }

  return (
    <>
      <ColumnHeader />
      {collections.map((collection) => {
        const stats = statsById[collection.id];
        const description = collection.description?.trim();
        return (
          <DataRow
            key={collection.id}
            href={`/collections/${collection.id}`}
            title={collection.name}
            /* Rendered only when present — an absent optional field gets no
               placeholder standing in for it, so rows without a description stay
               single-line rather than reserving space for nothing. */
            subtitle={description || undefined}
            columns={[
              <span key="docs" className={`font-mono tabular-nums ${COL.docs}`}>
                {stats?.document_count?.toLocaleString() ?? "—"}
              </span>,
              <span key="chunks" className={`font-mono tabular-nums ${COL.chunks}`}>
                {stats?.chunk_count?.toLocaleString() ?? "—"}
              </span>,
              <span
                key="updated"
                className={`font-mono tabular-nums text-meta ${COL.updated}`}
                title={parseApiDate(collection.updated_at)?.toLocaleString()}
              >
                {formatTimeAgoCompact(collection.updated_at)}
              </span>,
            ]}
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Browse files in ${collection.name}`}
                  onClick={() => router.push(`/collections/${collection.id}/files`)}
                >
                  <Files className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${collection.name}`}
                  className="hover:text-data-neg"
                  onClick={() => onDeleteRequest(collection)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </>
            }
          />
        );
      })}
    </>
  );
}
