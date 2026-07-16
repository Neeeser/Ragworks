"use client";

import { ArrowRight, FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatTracePreview } from "@/components/traces/explanations/summary-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ItemRef, TraceFocusedItem } from "@/lib/types";

type ResultListProps = {
  title: string;
  ariaLabel: string;
  items: ItemRef[];
  scoreLabel?: string;
  focusedItemId: string | null;
  contextItems: TraceFocusedItem[];
  previews?: ReadonlyMap<string, string>;
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
    <section className="min-w-0 rounded-xl border border-hairline bg-surface p-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        <span className="font-mono text-[10px] text-meta">{items.length} results</span>
        {scoreLabel ? (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-accent-cyan">
            {scoreLabel}
          </span>
        ) : null}
      </div>
      <ol
        aria-label={ariaLabel}
        className={cn("mt-2 space-y-1.5 overflow-y-auto pr-1", compact ? "max-h-40" : "max-h-64")}
      >
        {items.map((item, index) => {
          const focused = item.id === focusedItemId;
          const selected = item.id === inspectedItemId;
          const context = contextById.get(item.id);
          const preview = context?.text ?? previews.get(item.id);
          return (
            <li
              key={item.id}
              ref={focused ? focusedRef : undefined}
              aria-current={focused ? "true" : undefined}
              className={cn(
                "overflow-hidden rounded-lg border transition",
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
                className="w-full px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-violet"
              >
                <span className="flex items-center gap-2">
                  <span className="w-7 shrink-0 font-mono text-[10px] text-muted">
                    #{index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">
                    {context?.filename ?? `Result ${index + 1}`}
                    {context?.chunk_index !== null && context?.chunk_index !== undefined
                      ? ` · Chunk ${context.chunk_index + 1}`
                      : ""}
                  </span>
                  {typeof item.score === "number" ? (
                    <span className="shrink-0 font-mono text-[10px] text-accent-cyan">
                      {scoreText(item.score)}
                    </span>
                  ) : null}
                </span>
                {preview ? (
                  <span className="mt-1 block line-clamp-2 pl-9 text-xs leading-relaxed text-body">
                    {formatTracePreview(preview)}
                  </span>
                ) : null}
              </button>
              {selected && (context || (onFocusItem && item.id !== focusedItemId)) ? (
                <div className="flex flex-wrap justify-end gap-2 border-t border-hairline px-2.5 py-2">
                  {context && onOpenArtifact ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onOpenArtifact(context)}
                      className="gap-1.5"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      Open chunk
                    </Button>
                  ) : null}
                  {onFocusItem && item.id !== focusedItemId ? (
                    <Button size="sm" onClick={() => onFocusItem(item.id)} className="gap-1.5">
                      Trace this result
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
