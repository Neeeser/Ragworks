"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { prettyJson, timeAgo } from "@/lib/utils";

import type { ChunkDetail } from "@/lib/types";

type RenderMode = "text" | "markdown";

type ChunkPreviewOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  detail: ChunkDetail | null;
  defaultRenderMode?: RenderMode;
};

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

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId} backdropClassName="bg-black/80">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Chunk preview</p>
            <h2 id={titleId} className="mt-2 text-2xl font-semibold text-white">
              {document.name}
            </h2>
            <p className="text-sm text-slate-400">
              Chunk #{chunk.chunk_index + 1} · {chunk.chunk_strategy} · {chunk.chunk_size} tokens
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 p-0 text-slate-300"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-5 grid flex-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex flex-col gap-3 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">Chunk text</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRenderMode("text")}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    renderMode === "text"
                      ? "bg-violet-500/20 text-violet-100"
                      : "bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  Plain
                </button>
                <button
                  type="button"
                  onClick={() => setRenderMode("markdown")}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    renderMode === "markdown"
                      ? "bg-violet-500/20 text-violet-100"
                      : "bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  Markdown
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-slate-100">
              {renderMode === "markdown" ? (
                <div className="prose prose-invert max-w-none text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownSource}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{chunk.text || ""}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 overflow-hidden">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-slate-300">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Details</p>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span>Document</span>
                  <span className="text-right text-slate-100">{document.name}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Indexed</span>
                  <span className="text-right text-slate-100">{timeAgo(chunk.created_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Chunk</span>
                  <span className="text-right text-slate-100">#{chunk.chunk_index + 1}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Strategy</span>
                  <span className="text-right text-slate-100">{chunk.chunk_strategy}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Size</span>
                  <span className="text-right text-slate-100">{chunk.chunk_size} tokens</span>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-slate-300">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Metadata</p>
              <pre className="mt-3 max-h-full overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950/50 p-3 text-[11px] text-slate-200">
                {prettyJson(chunk.metadata)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
