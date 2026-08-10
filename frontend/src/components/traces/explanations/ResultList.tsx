"use client";

import { FileText, LocateFixed } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatTracePreview } from "@/components/traces/explanations/summary-data";
import { MediaThumbnail } from "@/components/ui/asset-image";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";
import { cn } from "@/lib/utils";

import type { MediaAssetRefShape } from "@/components/traces/values/shape-guards";
import type { ItemRef, TraceFocusedItem } from "@/lib/types";

type ResultListProps = {
  title: string;
  ariaLabel: string;
  items: ItemRef[];
  scoreLabel?: string;
  focusedItemId: string | null;
  contextItems: TraceFocusedItem[];
  previews?: ReadonlyMap<string, string>;
  /** Each result's stored image, keyed by id. An image result previews as a
   * derived `[image: …]` filename, which says nothing about the picture. */
  media?: ReadonlyMap<string, MediaAssetRefShape>;
  onFocusItem?: (itemId: string) => void;
  onOpenArtifact?: (item: TraceFocusedItem) => void;
  compact?: boolean;
};

const scoreText = (score: number): string =>
  Math.abs(score) >= 10 ? score.toFixed(3) : score.toFixed(4);

/** Ordered rank list with local row inspection and an explicit trace action. */
export function ResultList({
  title,
  ariaLabel,
  items,
  scoreLabel,
  focusedItemId,
  contextItems,
  previews = new Map(),
  media = new Map(),
  onFocusItem,
  onOpenArtifact,
  compact = false,
}: ResultListProps) {
  const initialInspected =
    (focusedItemId && items.some((item) => item.id === focusedItemId) ? focusedItemId : null) ??
    items[0]?.id ??
    null;
  const [inspectedItemId, setInspectedItemId] = useState<string | null>(initialInspected);
  const focusedRef = useRef<HTMLLIElement | null>(null);
  const contextById = useMemo(
    () => new Map(contextItems.map((item) => [item.id, item])),
    [contextItems],
  );

  useEffect(() => {
    focusedRef.current?.scrollIntoView?.({ block: "center", behavior: "auto" });
  }, [focusedItemId]);

  return (
    <section className="min-w-0 rounded-panel border border-hairline bg-surface p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-ui font-medium text-primary">{title}</h3>
        <Readout label="Results">{items.length}</Readout>
        {scoreLabel ? <InstrumentLabel className="ml-auto">{scoreLabel}</InstrumentLabel> : null}
      </div>
      <ol
        aria-label={ariaLabel}
        className={cn("mt-2 space-y-1 overflow-y-auto pr-1", compact ? "max-h-40" : "max-h-64")}
      >
        {items.map((item, index) => {
          const focused = item.id === focusedItemId;
          const selected = item.id === inspectedItemId;
          const context = contextById.get(item.id);
          const preview = context?.text ?? previews.get(item.id);
          const baseTitle = context?.filename ?? `Result ${index + 1}`;
          const chunkTitle =
            context?.chunk_index !== null && context?.chunk_index !== undefined
              ? ` · Chunk ${context.chunk_index + 1}`
              : "";
          const title = `${baseTitle}${chunkTitle}`;
          return (
            <li
              key={item.id}
              ref={focused ? focusedRef : undefined}
              aria-current={focused ? "true" : undefined}
              className={cn(
                "relative overflow-hidden rounded-control border transition-colors duration-80 ease-standard",
                focused
                  ? "border-accent-cyan/60 bg-accent-cyan/10"
                  : selected
                    ? "border-strong bg-canvas"
                    : "border-transparent hover:border-hairline hover:bg-canvas",
              )}
            >
              <button
                type="button"
                aria-label={`Inspect result ${item.id}`}
                aria-pressed={selected}
                onClick={() => setInspectedItemId(item.id)}
                className="w-full px-2 py-2 pr-24 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-violet"
              >
                <span className="flex items-center gap-2">
                  <span className="w-7 shrink-0 font-mono text-instrument tabular-nums text-muted">
                    #{index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ui font-medium text-primary">
                    {title}
                  </span>
                  {typeof item.score === "number" ? (
                    <span className="shrink-0 font-mono text-instrument tabular-nums text-accent-cyan">
                      {scoreText(item.score)}
                    </span>
                  ) : null}
                </span>
                <MediaThumbnail
                  media={media.get(item.id)}
                  alt={`Image result ${item.id}`}
                  className="ml-9 mt-1 max-h-24"
                />
                {preview ? (
                  <span className="mt-1 block line-clamp-2 pl-9 text-ui leading-relaxed text-body">
                    {formatTracePreview(preview)}
                  </span>
                ) : null}
              </button>
              {onFocusItem && !focused ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Trace result ${title}`}
                  onClick={() => onFocusItem(item.id)}
                  className="absolute right-1 top-1 text-instrument"
                >
                  <LocateFixed className="h-3 w-3" aria-hidden />
                  Trace result
                </Button>
              ) : null}
              {selected && context && onOpenArtifact ? (
                <div className="flex flex-wrap justify-end gap-1 border-t border-hairline px-2 py-2">
                  <Button variant="secondary" size="sm" onClick={() => onOpenArtifact(context)}>
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    Open chunk
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
