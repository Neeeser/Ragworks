"use client";

import { X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { TraceFocusedItem } from "@/lib/types";

type FocusHeaderProps = {
  focusedItemId: string;
  focusedItem: TraceFocusedItem | null;
  /** True when the trace covers only the ingestion run (Files-page entry). */
  ingestionOnly?: boolean;
  onClearFocus: () => void;
};

/** "Chunk 48 of 74" — displayed ordinals are 1-based; storage order is 0-based. */
const chunkOrdinal = (item: TraceFocusedItem): string | null => {
  if (item.chunk_index === null || item.chunk_index === undefined) return null;
  const position = item.chunk_index + 1;
  return item.chunk_count ? `Chunk ${position} of ${item.chunk_count}` : `Chunk ${position}`;
};

/**
 * The focused result's identity card: what text is being traced, which
 * document it lives in, and where it sits among the document's chunks. The
 * raw vector id stays visible as monospace metadata — it's how the item
 * appears in node payloads — but never presented as a rank.
 */
export function FocusHeader({
  focusedItemId,
  focusedItem,
  ingestionOnly = false,
  onClearFocus,
}: FocusHeaderProps) {
  const [expanded, setExpanded] = useState(false);
  const resolved = focusedItem?.status === "resolved";
  const ordinal = focusedItem ? chunkOrdinal(focusedItem) : null;

  return (
    <section
      aria-label="Focused result"
      className="shrink-0 border-b border-hairline bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent-cyan">
          Tracing result
        </p>
        {resolved && focusedItem?.filename ? (
          <span className="text-xs font-medium text-primary">{focusedItem.filename}</span>
        ) : null}
        {resolved && ordinal ? <span className="text-xs text-muted">{ordinal}</span> : null}
        <span className="max-w-[260px] truncate font-mono text-[10px] text-meta">
          {focusedItemId}
        </span>
        <span className="ml-auto">
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
      {resolved && focusedItem?.text ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="mt-2 block w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-left text-sm leading-relaxed text-body transition hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <span className={cn("whitespace-pre-wrap", !expanded && "line-clamp-3")}>
            {focusedItem.text}
          </span>
        </button>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Chunk text unavailable — the stored chunk behind this id no longer exists (deleted or
          re-ingested content). The recorded journey below still applies.
        </p>
      )}
      {ingestionOnly ? (
        <p className="mt-2 text-xs text-muted">
          This trace covers ingestion only — how the chunk was created and indexed. To follow it
          through retrieval, trace it from a search result.
        </p>
      ) : null}
    </section>
  );
}
