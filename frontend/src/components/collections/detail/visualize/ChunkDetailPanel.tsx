"use client";

import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { prettyJson, timeAgo, truncate } from "@/lib/utils";

import type { ChunkDetail, UmapPoint } from "@/lib/types";

type ChunkDetailPanelProps = {
  detail: ChunkDetail | null;
  loading: boolean;
  selectedPoint: UmapPoint | null;
  errorMessage: string | null;
};

export function ChunkDetailPanel({
  detail,
  loading,
  selectedPoint,
  errorMessage,
}: ChunkDetailPanelProps) {
  if (!selectedPoint) {
    return (
      <GlassCard className="rounded-3xl border border-white/10 p-6 text-sm text-slate-300">
        Select a point to see chunk details.
      </GlassCard>
    );
  }

  if (loading) {
    return (
      <GlassCard className="flex items-center justify-center rounded-3xl border border-white/10 p-6">
        <Loader className="h-5 w-5" />
      </GlassCard>
    );
  }

  if (errorMessage) {
    return (
      <GlassCard className="rounded-3xl border border-white/10 p-6 text-sm text-rose-200">
        {errorMessage}
      </GlassCard>
    );
  }

  if (!detail) {
    return (
      <GlassCard className="rounded-3xl border border-white/10 p-6 text-sm text-slate-300">
        No chunk details available.
      </GlassCard>
    );
  }

  const { document, chunk } = detail;

  return (
    <GlassCard className="rounded-3xl border border-white/10 p-6 text-sm text-slate-200">
      <div className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Document</p>
          <p className="mt-2 text-base font-semibold text-white">{document.name}</p>
          <p className="text-xs text-slate-400">Indexed {timeAgo(chunk.created_at)}</p>
        </div>
        <div className="grid gap-2 text-xs text-slate-300">
          <div className="flex items-center justify-between">
            <span>Chunk</span>
            <span className="text-slate-100">#{chunk.chunk_index + 1}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Strategy</span>
            <span className="text-slate-100">{chunk.chunk_strategy}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Size</span>
            <span className="text-slate-100">{chunk.chunk_size} tokens</span>
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Text</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">
            {truncate(chunk.text, 600)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Metadata</p>
          <pre className="mt-2 max-h-56 overflow-auto rounded-2xl bg-slate-950/40 p-3 text-xs text-slate-200">
            {prettyJson(chunk.metadata)}
          </pre>
        </div>
      </div>
    </GlassCard>
  );
}
