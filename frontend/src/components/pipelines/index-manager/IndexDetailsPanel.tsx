"use client";

import { Trash2 } from "lucide-react";

import type { VectorIndex } from "@/lib/types";

type IndexDetailsPanelProps = {
  index: VectorIndex | null;
  onDelete: (name: string) => void;
};

/** Read-only detail card for the selected vector index, plus the entry point into
 * the delete-confirmation flow (owned by the parent IndexManagerModal). */
export function IndexDetailsPanel({ index, onDelete }: IndexDetailsPanelProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Index details</p>
        <button
          type="button"
          className="rounded-full border border-white/10 p-2 text-slate-300 transition hover:border-rose-400/60 hover:text-rose-200 disabled:opacity-40"
          onClick={() => index && onDelete(index.name)}
          disabled={!index}
          aria-label="Delete index"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {index ? (
        <div className="mt-4 grid gap-4 text-sm text-slate-200 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Name</p>
            <p className="text-base font-semibold text-white">{index.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Status</p>
            <p className="text-sm text-slate-200">
              {(index.status as { state?: string } | null)?.state ?? "Unknown"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Backend</p>
            <p className="text-sm text-slate-200">
              {index.backend === "pgvector" ? "pgvector (PostgreSQL)" : "Pinecone"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Vector type</p>
            <p className="text-sm text-slate-200">{index.vector_type ?? "dense"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Dimension</p>
            <p className="text-sm text-slate-200">{index.dimension ?? "n/a"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Metric</p>
            <p className="text-sm text-slate-200">{index.metric ?? "cosine"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Host</p>
            <p className="text-xs text-slate-300 break-all">{index.host ?? "Not available"}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-400">Select an index to see details.</p>
      )}
    </div>
  );
}
