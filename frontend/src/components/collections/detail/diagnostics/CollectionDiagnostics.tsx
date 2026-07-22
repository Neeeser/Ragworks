"use client";

import { Loader2 } from "lucide-react";

import { GlassCard } from "@/components/ui/panel";

import { DiagnosticItem } from "./DiagnosticItem";
import { useCollectionDiagnostics } from "./use-collection-diagnostics";

import type { CollectionDiagnostic, DiagnosticCategory } from "@/lib/types";

const CATEGORY_ORDER: DiagnosticCategory[] = [
  "embedding",
  "backend_storage",
  "index_config",
  "pipeline_compatibility",
  "node_config",
  "run_failures",
  "data_freshness",
];

const CATEGORY_LABEL: Record<DiagnosticCategory, string> = {
  embedding: "Embedding compatibility",
  backend_storage: "Vector-store backend",
  index_config: "Index configuration",
  pipeline_compatibility: "Pipeline compatibility",
  node_config: "Node configuration",
  run_failures: "Recent run failures",
  data_freshness: "Data freshness",
};

interface CollectionDiagnosticsProps {
  collectionId: string;
  token: string;
}

function groupByCategory(
  diagnostics: CollectionDiagnostic[],
): Map<DiagnosticCategory, CollectionDiagnostic[]> {
  const groups = new Map<DiagnosticCategory, CollectionDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const bucket = groups.get(diagnostic.category) ?? [];
    bucket.push(diagnostic);
    groups.set(diagnostic.category, bucket);
  }
  return groups;
}

/** The Diagnostics tab: findings grouped by category, with an empty state. */
export function CollectionDiagnostics({ collectionId, token }: CollectionDiagnosticsProps) {
  const { data, loading, error } = useCollectionDiagnostics(token, collectionId);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted" role="status">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Running diagnostics…
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard className="rounded-3xl border border-data-neg/30 bg-data-neg/10 p-4 text-sm text-data-neg">
        {error}
      </GlassCard>
    );
  }

  if (!data || data.diagnostics.length === 0) {
    return (
      <GlassCard className="rounded-3xl p-6 text-sm text-muted">
        No diagnostics — pipelines and indexed data look consistent.
      </GlassCard>
    );
  }

  const groups = groupByCategory(data.diagnostics);

  return (
    <div className="space-y-6">
      {CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => (
        <GlassCard key={category} className="rounded-3xl p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
            {CATEGORY_LABEL[category]}
          </h2>
          <div className="mt-4 space-y-3">
            {groups.get(category)!.map((diagnostic, index) => (
              <DiagnosticItem key={`${diagnostic.code}-${index}`} diagnostic={diagnostic} />
            ))}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
