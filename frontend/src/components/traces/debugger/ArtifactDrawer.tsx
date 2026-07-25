"use client";

import { Columns3, FileText, X } from "lucide-react";
import { useId, useState } from "react";

import { HighlightedTraceText } from "@/components/traces/debugger/HighlightedTraceText";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { InstrumentLabel } from "@/components/ui/instrument-label";
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
    <div className="min-h-0 flex-1 overflow-auto rounded-panel border border-hairline bg-canvas p-4">
      <p className="max-w-[66ch] whitespace-pre-wrap text-ui leading-relaxed text-body">
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
        "flex min-h-0 flex-1 flex-col rounded-panel border bg-canvas",
        focused ? "border-accent-cyan/55" : "border-hairline",
      )}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
        <Chip tone="chunk">{chunkOrdinal(item) ?? "Recorded artifact"}</Chip>
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-primary">
          {item.filename}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="max-w-[66ch] whitespace-pre-wrap text-ui leading-relaxed text-body">
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

/** Dedicated reader for focused trace artifacts; new media add renderer entries. */
export function ArtifactDrawer({
  item,
  contextItems = [],
  query,
  initialMode = "reader",
  onClose,
}: ArtifactDrawerProps) {
  const titleId = useId();
  const [contextMode, setContextMode] = useState(initialMode === "context");
  if (!item) return null;

  const ordinal = chunkOrdinal(item);
  const title = [item.filename ?? "Focused chunk", ordinal].filter(Boolean).join(" · ");
  const renderer = RENDERERS.find((entry) => entry.matches(item));
  const Renderer = renderer?.Component;
  const { previous, next } = adjacentChunks(item, contextItems);
  const contextWindow = [previous, item, next].filter(
    (candidate): candidate is TraceFocusedItem => candidate !== null,
  );

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId} backdropClassName="bg-canvas/80">
      <aside
        className={cn(
          "card-surface ml-auto flex h-[calc(100dvh-5rem)] max-h-full w-full flex-col bg-canvas-raised p-4 text-primary shadow-elevation-2",
          contextMode ? "max-w-6xl" : "max-w-3xl",
        )}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-hairline pb-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface text-accent-cyan">
            <FileText className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="truncate text-head font-semibold tracking-[-0.01em] text-primary"
            >
              {title}
            </h2>
            <p className="mt-1 truncate font-mono text-instrument text-meta">{item.id}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close artifact"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </header>
        {!contextMode && (previous || next) ? (
          <div className="flex shrink-0 justify-end border-b border-hairline py-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setContextMode(true)}
              aria-label="Show source context"
            >
              <Columns3 className="h-3.5 w-3.5" aria-hidden />
              Show source context
            </Button>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          {contextMode ? (
            <section aria-label="Source context" className="flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
                <InstrumentLabel>Source context</InstrumentLabel>
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
          ) : Renderer ? (
            <Renderer item={item} query={query} />
          ) : (
            <p className="text-ui text-muted">No renderer is available for this artifact.</p>
          )}
        </div>
      </aside>
    </ModalOverlay>
  );
}
