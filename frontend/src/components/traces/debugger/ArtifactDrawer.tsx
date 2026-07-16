"use client";

import { ChevronLeft, ChevronRight, FileText, X } from "lucide-react";
import { useId, useState } from "react";

import { HighlightedTraceText } from "@/components/traces/debugger/HighlightedTraceText";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { cn } from "@/lib/utils";

import type { TraceFocusedItem } from "@/lib/types";
import type { ComponentType } from "react";

type ArtifactRendererProps = {
  item: TraceFocusedItem;
  query?: string | null;
};

type ArtifactRenderer = {
  matches: (item: TraceFocusedItem) => boolean;
  Component: ComponentType<ArtifactRendererProps>;
};

const chunkOrdinal = (item: TraceFocusedItem): string | null => {
  if (item.chunk_index === null || item.chunk_index === undefined) return null;
  const position = item.chunk_index + 1;
  return item.chunk_count ? `Chunk ${position} of ${item.chunk_count}` : `Chunk ${position}`;
};

function TextArtifact({ item, query }: ArtifactRendererProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-hairline bg-canvas p-5">
      <p className="whitespace-pre-wrap text-sm leading-7 text-body">
        <HighlightedTraceText text={item.text || "No chunk content available."} query={query} />
      </p>
    </div>
  );
}

function ComparisonArtifact({
  item,
  query,
  focused = false,
}: ArtifactRendererProps & { focused?: boolean }) {
  return (
    <article
      className={cn(
        "flex min-h-0 flex-1 flex-col rounded-2xl border bg-canvas",
        focused ? "border-accent-cyan/55" : "border-hairline",
      )}
    >
      <header className="shrink-0 border-b border-hairline px-4 py-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-stage-chunk">
          {chunkOrdinal(item) ?? "Recorded artifact"}
        </p>
        <p className="mt-1 truncate text-xs font-medium text-primary">{item.filename}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <p className="whitespace-pre-wrap text-sm leading-7 text-body">
          <HighlightedTraceText text={item.text || "No chunk content available."} query={query} />
        </p>
      </div>
    </article>
  );
}

const RENDERERS: ArtifactRenderer[] = [
  { matches: (item) => typeof item.text === "string", Component: TextArtifact },
];

type ArtifactDrawerProps = {
  item: TraceFocusedItem | null;
  contextItems?: TraceFocusedItem[];
  query?: string | null;
  initialMode?: "reader" | "context";
  onNavigate?: (item: TraceFocusedItem) => void;
  onClose: () => void;
};

const adjacentChunks = (
  item: TraceFocusedItem,
  contextItems: TraceFocusedItem[],
): { previous: TraceFocusedItem | null; next: TraceFocusedItem | null } => {
  if (item.chunk_index === null || item.chunk_index === undefined) {
    return { previous: null, next: null };
  }
  const siblings = contextItems
    .filter(
      (candidate) =>
        candidate.document_id === item.document_id &&
        candidate.chunk_index !== null &&
        candidate.chunk_index !== undefined,
    )
    .sort((left, right) => (left.chunk_index ?? 0) - (right.chunk_index ?? 0));
  const current = siblings.findIndex((candidate) => candidate.id === item.id);
  return {
    previous: current > 0 ? (siblings[current - 1] ?? null) : null,
    next: current >= 0 && current < siblings.length - 1 ? (siblings[current + 1] ?? null) : null,
  };
};

type AdjacentControlsProps = {
  previous: TraceFocusedItem | null;
  next: TraceFocusedItem | null;
  onNavigate?: (item: TraceFocusedItem) => void;
  onCompare: (itemId: string) => void;
};

function AdjacentControls({ previous, next, onNavigate, onCompare }: AdjacentControlsProps) {
  if (!previous && !next) return null;
  return (
    <div className="shrink-0 border-b border-hairline py-2">
      <nav aria-label="Adjacent chunks" className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!previous}
          onClick={() => previous && onNavigate?.(previous)}
          aria-label="Previous chunk"
          className="gap-1.5"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Previous chunk
        </Button>
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-meta">
          Source order
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!next}
          onClick={() => next && onNavigate?.(next)}
          aria-label="Next chunk"
          className="gap-1.5"
        >
          Next chunk
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </nav>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {previous ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onCompare(previous.id)}
            aria-label="Compare with previous chunk"
          >
            Compare previous
          </Button>
        ) : null}
        {next ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onCompare(next.id)}
            aria-label="Compare with next chunk"
          >
            Compare next
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Dedicated reader for focused trace artifacts; new media add renderer entries. */
export function ArtifactDrawer({
  item,
  contextItems = [],
  query,
  initialMode = "reader",
  onNavigate,
  onClose,
}: ArtifactDrawerProps) {
  const titleId = useId();
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState(initialMode === "context");
  if (!item) return null;

  const ordinal = chunkOrdinal(item);
  const title = [item.filename ?? "Focused chunk", ordinal].filter(Boolean).join(" · ");
  const renderer = RENDERERS.find((entry) => entry.matches(item));
  const Renderer = renderer?.Component;
  const { previous, next } = adjacentChunks(item, contextItems);
  const comparisonItem =
    contextItems.find(
      (candidate) => candidate.id === comparisonId && candidate.document_id === item.document_id,
    ) ?? null;
  const comparisonPair = comparisonItem
    ? [item, comparisonItem].sort(
        (left, right) => (left.chunk_index ?? 0) - (right.chunk_index ?? 0),
      )
    : [];
  const contextWindow = [previous, item, next].filter(
    (candidate): candidate is TraceFocusedItem => candidate !== null,
  );

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId} backdropClassName="bg-canvas/80">
      <aside
        className={cn(
          "ml-auto flex h-[calc(100dvh-5rem)] max-h-full w-full flex-col rounded-3xl border border-hairline bg-canvas-raised p-5 text-primary shadow-elevation-2 sm:p-6",
          contextMode ? "max-w-6xl" : "max-w-3xl",
        )}
      >
        <header className="flex shrink-0 items-start gap-4 border-b border-hairline pb-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-hairline bg-surface text-accent-cyan">
            <FileText className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
              Focused artifact
            </p>
            <h2 id={titleId} className="mt-1 truncate text-lg font-semibold text-primary">
              {title}
            </h2>
            <p className="mt-1 truncate font-mono text-[10px] text-meta">{item.id}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close artifact"
            className="h-9 w-9 shrink-0 rounded-full border border-hairline p-0"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </header>
        <AdjacentControls
          previous={previous}
          next={next}
          onNavigate={onNavigate}
          onCompare={setComparisonId}
        />
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          {contextMode ? (
            <section aria-label="Source context" className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-stage-chunk">
                    Source context
                  </p>
                  <p className="mt-1 text-xs text-muted">Previous, focused, and next chunks</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setContextMode(false)}
                  aria-label="Show focused chunk only"
                >
                  Focused chunk only
                </Button>
              </div>
              <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-3">
                {contextWindow.map((contextItem) => (
                  <ComparisonArtifact
                    key={contextItem.id}
                    item={contextItem}
                    query={query}
                    focused={contextItem.id === item.id}
                  />
                ))}
              </div>
            </section>
          ) : comparisonItem ? (
            <section aria-label="Boundary comparison" className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-stage-chunk">
                    Boundary comparison
                  </p>
                  <p className="mt-1 text-xs text-muted">Adjacent source chunks</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setComparisonId(null)}
                  aria-label="Close comparison"
                >
                  Close comparison
                </Button>
              </div>
              <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
                {comparisonPair.map((comparison) => (
                  <ComparisonArtifact
                    key={comparison.id}
                    item={comparison}
                    query={query}
                    focused={comparison.id === item.id}
                  />
                ))}
              </div>
            </section>
          ) : Renderer ? (
            <Renderer item={item} query={query} />
          ) : (
            <p className="text-sm text-muted">No renderer is available for this artifact.</p>
          )}
        </div>
      </aside>
    </ModalOverlay>
  );
}
