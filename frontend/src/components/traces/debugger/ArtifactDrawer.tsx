"use client";

import { FileText, X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";

import type { TraceFocusedItem } from "@/lib/types";
import type { ComponentType } from "react";

type ArtifactRendererProps = {
  item: TraceFocusedItem;
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

function TextArtifact({ item }: ArtifactRendererProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-hairline bg-canvas p-5">
      <p className="whitespace-pre-wrap text-sm leading-7 text-body">
        {item.text || "No chunk content available."}
      </p>
    </div>
  );
}

const RENDERERS: ArtifactRenderer[] = [
  { matches: (item) => typeof item.text === "string", Component: TextArtifact },
];

type ArtifactDrawerProps = {
  item: TraceFocusedItem | null;
  onClose: () => void;
};

/** Dedicated reader for focused trace artifacts; new media add renderer entries. */
export function ArtifactDrawer({ item, onClose }: ArtifactDrawerProps) {
  const titleId = useId();
  if (!item) return null;

  const ordinal = chunkOrdinal(item);
  const title = [item.filename ?? "Focused chunk", ordinal].filter(Boolean).join(" · ");
  const renderer = RENDERERS.find((entry) => entry.matches(item));
  const Renderer = renderer?.Component;

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId} backdropClassName="bg-canvas/80">
      <aside className="ml-auto flex h-[calc(100dvh-5rem)] max-h-full w-full max-w-3xl flex-col rounded-3xl border border-hairline bg-canvas-raised p-5 text-primary shadow-elevation-2 sm:p-6">
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
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          {Renderer ? (
            <Renderer item={item} />
          ) : (
            <p className="text-sm text-muted">No renderer is available for this artifact.</p>
          )}
        </div>
      </aside>
    </ModalOverlay>
  );
}
