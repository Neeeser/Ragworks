"use client";

import { Columns3, PanelRightOpen, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { TraceFocusedItem } from "@/lib/types";

type FocusHeaderProps = {
  focusedItemId: string;
  focusedItem: TraceFocusedItem | null;
  query?: string | null;
  /** True when the trace covers only the ingestion run (Files-page entry). */
  ingestionOnly?: boolean;
  onOpenArtifact: () => void;
  onCompareContext?: () => void;
  onClearFocus: () => void;
};

/** "Chunk 48 of 74" — displayed ordinals are 1-based; storage order is 0-based. */
const chunkOrdinal = (item: TraceFocusedItem): string | null => {
  if (item.chunk_index === null || item.chunk_index === undefined) return null;
  const position = item.chunk_index + 1;
  return item.chunk_count ? `Chunk ${position} of ${item.chunk_count}` : `Chunk ${position}`;
};

/**
 * Compact identity for the focused result. Content lives in the artifact
 * drawer so long chunks and future media do not distort the debugger layout.
 */
export function FocusHeader({
  focusedItemId,
  focusedItem,
  query,
  ingestionOnly = false,
  onOpenArtifact,
  onCompareContext,
  onClearFocus,
}: FocusHeaderProps) {
  const resolved = focusedItem?.status === "resolved";
  const ordinal = focusedItem ? chunkOrdinal(focusedItem) : null;

  return (
    <section
      aria-label="Focused result"
      className="shrink-0 border-b border-hairline bg-surface px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent-cyan">
          Focused chunk
        </p>
        {resolved && focusedItem?.filename ? (
          <span className="text-xs font-medium text-primary">{focusedItem.filename}</span>
        ) : null}
        {resolved && ordinal ? <span className="text-xs text-muted">{ordinal}</span> : null}
        <span className="max-w-[260px] truncate font-mono text-[10px] text-meta">
          {focusedItemId}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {resolved && focusedItem?.text ? (
            <>
              {onCompareContext ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onCompareContext}
                  className="gap-1.5"
                  aria-label="Compare focused context"
                >
                  <Columns3 className="h-3.5 w-3.5" aria-hidden />
                  Compare context
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenArtifact}
                className="gap-1.5"
                aria-label="Open focused chunk"
              >
                <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
                Open chunk
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFocus}
            className="gap-1.5 text-muted"
            aria-label="Exit focused trace"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Exit focus
          </Button>
        </span>
      </div>
      {query ? (
        <div className="mt-1.5 flex min-w-0 items-baseline gap-2 border-t border-hairline pt-1.5">
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.22em] text-meta">
            Query
          </span>
          <p className="truncate text-xs text-body" title={query}>
            {query}
          </p>
        </div>
      ) : null}
      {!resolved || !focusedItem?.text ? (
        <p className="mt-2 text-xs text-muted">
          Chunk text unavailable — the stored chunk behind this id no longer exists (deleted or
          re-ingested content). The recorded execution data still applies.
        </p>
      ) : null}
      {ingestionOnly ? (
        <p className="mt-2 text-xs text-muted">
          This trace covers ingestion only — how the chunk was created and indexed. To follow it
          through retrieval, trace it from a search result.
        </p>
      ) : null}
    </section>
  );
}
