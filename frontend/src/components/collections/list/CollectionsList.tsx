"use client";

import { Files, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DATA_ROW_ACTIONS_SLOT, DataRow, DataRowHeader } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { formatLatency, formatTimeAgoCompact } from "@/lib/format";

import type { Collection, CollectionStats } from "@/lib/types";

type CollectionsListProps = {
  collections: Collection[];
  statsById: Record<string, CollectionStats | undefined>;
  /** Pipeline id -> name, so a row can name the pipelines it is bound to. */
  onDeleteRequest: (collection: Collection) => void;
  onCreateRequest: () => void;
  loading?: boolean;
};

/**
 * Column widths shared by the header and every row, so numbers line up in a
 * readable column instead of each row measuring its own content.
 */
const COL = {
  docs: "w-14 text-right",
  chunks: "w-20 text-right",
  latency: "w-28 text-right",
  updated: "w-20 text-right",
  queried: "w-24 text-right",
};

function ColumnHeader() {
  return (
    <DataRowHeader
      hasLeading
      title="Name"
      columns={[
        <InstrumentLabel key="docs" className={COL.docs}>
          Docs
        </InstrumentLabel>,
        <InstrumentLabel key="chunks" className={COL.chunks}>
          Chunks
        </InstrumentLabel>,
        <InstrumentLabel key="latency" className={COL.latency}>
          Avg query
        </InstrumentLabel>,
        <InstrumentLabel key="updated" className={COL.updated}>
          Updated
        </InstrumentLabel>,
        <InstrumentLabel key="queried" className={COL.queried}>
          Queried
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
          <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-3">
            <Skeleton className="h-[7px] w-[7px] rounded-[2px]" />
            <Skeleton className="h-2 max-w-48 flex-1" />
            <Skeleton className={`h-2 ${COL.docs}`} />
            <Skeleton className={`h-2 ${COL.chunks}`} />
            <Skeleton className={`h-2 ${COL.latency}`} />
            <Skeleton className={`h-2 ${COL.updated}`} />
            <Skeleton className={`h-2 ${COL.queried}`} />
          </div>
          <span className={DATA_ROW_ACTIONS_SLOT} aria-hidden />
        </div>
      ))}
      <span className="sr-only">Loading collections</span>
    </div>
  );
}

/**
 * Health a collection's own counts can honestly support.
 *
 * There is no status column on a collection, so this is derived rather than
 * invented: documents that produced no chunks indexed nothing, which is the
 * failure a user needs to see from the list.
 */
function health(stats: CollectionStats | undefined): {
  tone: "pos" | "warn" | "neutral";
  label: string;
} {
  const docs = stats?.document_count ?? 0;
  const chunks = stats?.chunk_count ?? 0;
  if (docs === 0) return { tone: "neutral", label: "Empty" };
  if (chunks === 0) return { tone: "warn", label: "No chunks indexed" };
  return { tone: "pos", label: "Ready" };
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
      <Panel>
        <ColumnHeader />
        <LoadingRows />
      </Panel>
    );
  }

  if (collections.length === 0) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-ui text-muted">No collections yet.</p>
        {/* Plain primary: the top bar's New collection already carries this
            view's one glow, and an empty list shows both buttons at once. */}
        <Button size="sm" className="mt-3" onClick={onCreateRequest}>
          Create collection
        </Button>
      </Panel>
    );
  }

  return (
    <Panel>
      <ColumnHeader />
      {collections.map((collection) => {
        const stats = statsById[collection.id];
        const description = collection.description?.trim();
        const state = health(stats);
        return (
          <DataRow
            key={collection.id}
            href={`/collections/${collection.id}`}
            leading={<StatusDot tone={state.tone} />}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{collection.name}</span>
                {/* The dot carries the health; the pill names it, so the state
                    is readable without colour discrimination. */}
                <Chip tone={state.tone === "neutral" ? "neutral" : state.tone} dot={false}>
                  {state.label}
                </Chip>
              </span>
            }
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
              <span key="latency" className={`font-mono tabular-nums ${COL.latency}`}>
                {stats?.average_latency_ms == null ? (
                  <span className="text-muted">—</span>
                ) : (
                  formatLatency(stats.average_latency_ms)
                )}
              </span>,
              <Tooltip
                key="updated"
                content={parseApiDate(collection.updated_at)?.toLocaleString() ?? ""}
                triggerClassName={`justify-end ${COL.updated}`}
              >
                <span className="font-mono tabular-nums text-meta">
                  {formatTimeAgoCompact(collection.updated_at)}
                </span>
              </Tooltip>,
              <Tooltip
                key="queried"
                content={
                  stats?.last_used_at
                    ? (parseApiDate(stats.last_used_at)?.toLocaleString() ?? "")
                    : "Never queried"
                }
                triggerClassName={`justify-end ${COL.queried}`}
              >
                <span className="font-mono tabular-nums text-meta">
                  {stats?.last_used_at ? formatTimeAgoCompact(stats.last_used_at) : "—"}
                </span>
              </Tooltip>,
            ]}
            actions={
              <>
                {/* Icon-only, so each carries a hover tooltip as well as an
                    accessible name — a user must never have to click an icon to
                    learn what it does. The row itself opens the overview, so this
                    button's separate destination has to be stated. */}
                <Tooltip content="Browse files">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Browse files in ${collection.name}`}
                    onClick={() => router.push(`/collections/${collection.id}/files`)}
                  >
                    <Files className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </Tooltip>
                <Tooltip content="Delete collection">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${collection.name}`}
                    className="hover:text-data-neg"
                    onClick={() => onDeleteRequest(collection)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </Tooltip>
              </>
            }
          />
        );
      })}
    </Panel>
  );
}
