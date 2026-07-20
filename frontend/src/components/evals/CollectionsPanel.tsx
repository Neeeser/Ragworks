"use client";

import { Database, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GlassCard } from "@/components/ui/panel";
import { formatDateTime } from "@/lib/datetime";

import type { EvalCollection, EvalDataset, Pipeline } from "@/lib/types";

interface CollectionsPanelProps {
  collections: EvalCollection[];
  datasets: EvalDataset[];
  pipelines: Pipeline[];
  loading: boolean;
  onDelete: (collectionId: string) => Promise<boolean>;
}

export function CollectionsPanel({
  collections,
  datasets,
  pipelines,
  loading,
  onDelete,
}: CollectionsPanelProps) {
  const [pendingDelete, setPendingDelete] = useState<EvalCollection | null>(null);
  const [busy, setBusy] = useState(false);
  const datasetNames = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));
  const pipelineNames = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline.name]));

  return (
    <GlassCard className="rounded-3xl border border-hairline bg-surface p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
        Benchmark collections
      </p>
      <p className="mt-2 text-sm leading-relaxed text-body">
        Ingested benchmark corpora, keyed by dataset and ingestion pipeline. Runs that share an
        ingestion pipeline reuse the same collection; deleting one frees its vectors and files, and
        the next run re-ingests.
      </p>
      {collections.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          {loading ? "Loading…" : "Nothing provisioned yet."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {collections.map((collection) => {
            const dataset =
              (collection.dataset_id && datasetNames.get(collection.dataset_id)) || null;
            const pipeline =
              (collection.ingestion_pipeline_id &&
                pipelineNames.get(collection.ingestion_pipeline_id)) ||
              null;
            return (
              <li key={collection.id} className="rounded-2xl border border-hairline bg-canvas p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                      <Database className="h-3.5 w-3.5 text-accent-violet" aria-hidden />
                      {dataset ?? "Benchmark corpus"}
                    </div>
                    <p className="mt-1.5 truncate font-medium text-primary">{collection.name}</p>
                    {pipeline && (
                      <p className="mt-1 text-sm text-body">
                        Ingested with <span className="text-primary">{pipeline}</span>
                      </p>
                    )}
                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      <Stat label="docs" value={collection.num_documents.toLocaleString()} />
                      <Stat label="chunks" value={collection.num_chunks.toLocaleString()} />
                      <Stat label="updated" value={formatDateTime(collection.updated_at)} />
                    </dl>
                  </div>
                  <Button
                    variant="secondary"
                    className="shrink-0 px-4"
                    onClick={() => setPendingDelete(collection)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                    Prune
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Prune benchmark collection"
        description={`Delete ${pendingDelete?.name ?? "this collection"} — its vectors, files, and indexes. Past run results are kept; the next run against this ingestion config re-ingests.`}
        confirmLabel="Prune"
        confirmVariant="danger"
        loading={busy}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setBusy(true);
          await onDelete(pendingDelete.id);
          setBusy(false);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </GlassCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="font-mono text-[11px] uppercase tracking-[0.28em] text-meta">{label}</dt>
      <dd className="font-mono text-[11px] text-body">{value}</dd>
    </div>
  );
}
