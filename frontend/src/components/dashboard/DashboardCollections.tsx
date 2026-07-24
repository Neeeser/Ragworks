import { ArrowRight, FolderPlus } from "lucide-react";
import Link from "next/link";

import { GlassCard } from "@/components/ui/panel";

import type { Collection } from "@/lib/types";

type DashboardCollectionsProps = {
  collections: Collection[];
  pipelineNameById: Map<string, string>;
};

const PipelineChip = ({ label }: { label: string }) => (
  <span className="rounded-full border border-hairline bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
    {label}
  </span>
);

/**
 * The user's collections as the primary content of the overview. Each card links
 * straight to its detail view; an empty workspace shows a single create action
 * instead of a stat.
 */
export function DashboardCollections({ collections, pipelineNameById }: DashboardCollectionsProps) {
  return (
    <GlassCard className="rounded-3xl p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-primary">Your collections</h2>
        {collections.length > 0 ? (
          <Link
            href="/collections"
            className="flex items-center gap-1.5 rounded-full text-sm text-accent-violet transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>

      {collections.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-hairline px-6 py-12 text-center">
          <p className="max-w-sm text-pretty text-body">No collections yet.</p>
          <Link
            href="/collections"
            className="flex items-center gap-2 rounded-full bg-accent-violet px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <FolderPlus className="h-4 w-4" aria-hidden />
            New collection
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {collections.map((collection) => {
            const ingestion = pipelineNameById.get(collection.ingest_pipeline_id ?? "");
            const primaryTool = collection.tools.find((tool) => tool.is_primary);
            const retrieval = pipelineNameById.get(primaryTool?.pipeline_id ?? "");
            return (
              <Link
                key={collection.id}
                href={`/collections/${collection.id}`}
                className="group flex flex-col rounded-2xl border border-hairline bg-surface p-5 transition hover:border-strong hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <p className="text-base font-semibold text-primary">{collection.name}</p>
                <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted">
                  {collection.description || "No description yet."}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <PipelineChip label={ingestion ?? "Ingestion"} />
                  <PipelineChip label={retrieval ?? "Retrieval"} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
