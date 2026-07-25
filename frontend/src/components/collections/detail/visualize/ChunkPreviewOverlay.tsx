"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Markdown } from "@/components/ui/markdown";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Readout } from "@/components/ui/readout";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { formatTimeAgoCompact } from "@/lib/format";
import { cn, prettyJson } from "@/lib/utils";

import type { ChunkDetail } from "@/lib/types";

type RenderMode = "text" | "markdown";

type ChunkPreviewOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  detail: ChunkDetail | null;
  defaultRenderMode?: RenderMode;
};

const RENDER_MODES: Array<{ mode: RenderMode; label: string }> = [
  { mode: "text", label: "Plain" },
  { mode: "markdown", label: "Markdown" },
];

/**
 * The selected chunk at full size: the exact text a retriever would return,
 * rendered plain or as markdown, beside the record it came from.
 *
 * The docked pane truncates for density; this is where the whole value is read,
 * so it gets the height and the text gets a measure.
 */
export function ChunkPreviewOverlay({
  isOpen,
  onClose,
  detail,
  defaultRenderMode = "text",
}: ChunkPreviewOverlayProps) {
  const titleId = useId();
  const [renderMode, setRenderMode] = useState<RenderMode>(defaultRenderMode);
  const chunkId = detail?.chunk.id;

  // Re-sync to the caller's preferred mode whenever the overlay opens or a different
  // chunk is loaded, without clobbering a manual Plain/Markdown toggle mid-session.
  // Adjusting state during render (rather than in an effect) replaces a remount-via-
  // `key` hack callers previously needed for the same reset.
  const syncKey = `${isOpen ? "open" : "closed"}:${chunkId ?? "empty"}`;
  const [lastSyncKey, setLastSyncKey] = useState(syncKey);
  if (syncKey !== lastSyncKey) {
    setLastSyncKey(syncKey);
    if (isOpen) {
      setRenderMode(defaultRenderMode);
    }
  }

  if (!isOpen || !detail) {
    return null;
  }

  const markdownSource = detail.chunk.text?.trim()
    ? detail.chunk.text
    : "_No chunk content available._";

  const { document, chunk } = detail;
  const indexedAt = parseApiDate(chunk.created_at);

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId} backdropClassName="bg-canvas/80">
      <div className="card-surface flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden bg-canvas-raised shadow-elevation-2">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hairline px-3">
          {/* The dialog clips its own overflow for its rounded corners, so
              tooltips on its top row open downward. */}
          <Tooltip content={document.name} side="bottom" triggerClassName="min-w-0">
            <h2
              id={titleId}
              className="truncate text-head font-semibold tracking-[-0.01em] text-primary"
            >
              {document.name}
            </h2>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-3 py-2">
          <Readout label="Chunk">{`#${chunk.chunk_index + 1}`}</Readout>
          <Readout label="Strategy">{chunk.chunk_strategy}</Readout>
          <Readout label="Size">
            {chunk.chunk_size.toLocaleString()}
            <span className="text-muted"> tokens</span>
          </Readout>
          <Tooltip content={indexedAt?.toLocaleString() ?? ""} side="bottom">
            <Readout label="Indexed">{formatTimeAgoCompact(chunk.created_at)}</Readout>
          </Tooltip>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
              <InstrumentLabel>Chunk text</InstrumentLabel>
              <div
                role="group"
                aria-label="Render mode"
                className="ml-auto flex shrink-0 overflow-hidden rounded-control border border-hairline"
              >
                {RENDER_MODES.map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRenderMode(mode)}
                    aria-pressed={renderMode === mode}
                    className={cn(
                      "flex h-7 items-center px-2 text-ui transition-colors duration-80 ease-standard",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
                      renderMode === mode
                        ? "bg-accent-violet/15 text-accent-violet"
                        : "text-muted hover:bg-surface hover:text-primary",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {renderMode === "markdown" ? (
                <Markdown className="max-w-[66ch]">{markdownSource}</Markdown>
              ) : (
                <p className="max-w-[66ch] whitespace-pre-wrap text-ui leading-relaxed text-body">
                  {chunk.text || ""}
                </p>
              )}
            </div>
          </div>

          <div className="min-h-0 shrink-0 overflow-y-auto border-t border-hairline p-3 lg:w-[280px] lg:border-l lg:border-t-0">
            <InstrumentLabel>Metadata</InstrumentLabel>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded-control border border-hairline bg-surface p-2 font-mono text-instrument text-body">
              {prettyJson(chunk.metadata)}
            </pre>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
