import { Sparkles } from "lucide-react";
import Link from "next/link";

import { GlassCard } from "@/components/ui/panel";
import { timeAgo } from "@/lib/utils";

import type { Collection, Document } from "@/lib/types";

type DashboardActivitySectionProps = {
  recentDocuments: Document[];
  activeCollections: Collection[];
  pipelineNameById: Map<string, string>;
};

export function DashboardActivitySection({
  recentDocuments,
  activeCollections,
  pipelineNameById,
}: DashboardActivitySectionProps) {
  return (
    <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <GlassCard className="rounded-3xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">documents</p>
            <h2 className="text-2xl font-semibold text-white">Recent ingest history</h2>
          </div>
          <Link href="/collections" className="text-sm text-violet-300 hover:text-white">
            View collections
          </Link>
        </div>

        <div className="mt-6 space-y-4">
          {recentDocuments.length === 0 ? (
            <p className="text-sm text-slate-400">
              No documents yet. Upload your first source from the collections page.
            </p>
          ) : (
            recentDocuments.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-white">{doc.name}</p>
                  <p className="text-xs text-slate-400">
                    {doc.status.toUpperCase()} • {doc.num_chunks} chunks • {timeAgo(doc.created_at)}
                  </p>
                </div>
                <span className="text-xs text-slate-300">
                  {doc.chunk_strategy} • {doc.chunk_size} tokens
                </span>
              </div>
            ))
          )}
        </div>
      </GlassCard>

      <GlassCard className="rounded-3xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">collections</p>
            <h2 className="text-2xl font-semibold text-white">Active workspaces</h2>
          </div>
          <Sparkles className="h-5 w-5 text-violet-300" />
        </div>
        <div className="mt-6 space-y-4">
          {activeCollections.length === 0 ? (
            <p className="text-sm text-slate-400">Create your first collection to begin.</p>
          ) : (
            activeCollections.map((collection) => (
              <div
                key={collection.id}
                className="rounded-2xl border border-white/5 bg-white/5 p-4 text-sm"
              >
                <p className="text-base font-semibold text-white">{collection.name}</p>
                <p className="text-xs text-slate-400">{collection.description}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                  <span className="rounded-full bg-white/10 px-2 py-1">
                    {pipelineNameById.get(collection.ingestion_pipeline_id ?? "") ??
                      "Ingestion pipeline"}
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-1">
                    {pipelineNameById.get(collection.retrieval_pipeline_id ?? "") ??
                      "Retrieval pipeline"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </GlassCard>
    </section>
  );
}
