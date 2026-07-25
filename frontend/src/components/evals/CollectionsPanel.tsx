"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { corpusHealth } from "@/components/evals/lib/status";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataRow, DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { formatTimeAgoCompact } from "@/lib/format";

import type { EvalCollection, EvalDataset, Pipeline } from "@/lib/types";

interface CollectionsPanelProps {
  collections: EvalCollection[];
  datasets: EvalDataset[];
  pipelines: Pipeline[];
  loading: boolean;
  onDelete: (collectionId: string) => Promise<boolean>;
}

/** Column widths shared by the header, the rows, and the loading placeholder. */
const COL = {
  docs: "w-16 text-right",
  chunks: "w-20 text-right",
  status: "w-24",
  updated: "w-14 text-right",
};

function ColumnHeader() {
  return (
    <DataRowHeader
      hasLeading
      title="Collection"
      columns={[
        <InstrumentLabel key="docs" className={COL.docs}>
          Docs
        </InstrumentLabel>,
        <InstrumentLabel key="chunks" className={COL.chunks}>
          Chunks
        </InstrumentLabel>,
        <InstrumentLabel key="status" className={COL.status}>
          Status
        </InstrumentLabel>,
        <InstrumentLabel key="updated" className={COL.updated}>
          Updated
        </InstrumentLabel>,
      ]}
    />
  );
}

/**
 * The benchmark corpora runs ingested into, one per (dataset, ingestion
 * pipeline) pair.
 *
 * The header keeps one line of prose because it states a consequence the rows
 * cannot: pruning is safe for past results but costs the next run a re-ingest.
 */
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
    <section aria-label="Benchmark collections" className="card-surface">
      <div className="border-b border-hairline px-3 py-2">
        <h2 className="text-head font-semibold tracking-[-0.01em] text-primary">
          Benchmark collections
        </h2>
        <p className="mt-1 max-w-[66ch] text-instrument text-muted">
          Runs sharing an ingestion pipeline reuse one collection. Pruning frees its vectors and
          files; past results are kept and the next run re-ingests.
        </p>
      </div>

      <ColumnHeader />

      {loading ? (
        <DataRowSkeleton
          label="Loading benchmark collections"
          hasLeading
          hasSubtitle
          columnWidths={[COL.docs, COL.chunks, COL.status, COL.updated]}
        />
      ) : collections.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">
          Nothing provisioned yet. The first run against a dataset builds one.
        </p>
      ) : (
        collections.map((collection) => {
          const dataset =
            (collection.dataset_id && datasetNames.get(collection.dataset_id)) || null;
          const pipeline =
            (collection.ingestion_pipeline_id &&
              pipelineNames.get(collection.ingestion_pipeline_id)) ||
            null;
          const state = corpusHealth(collection.num_documents, collection.num_chunks);
          const provenance = [dataset, pipeline].filter(Boolean).join(" · ");
          return (
            <DataRow
              key={collection.id}
              leading={<StatusDot tone={state.tone} />}
              title={collection.name}
              subtitle={provenance || undefined}
              columns={[
                <span key="docs" className={`font-mono tabular-nums ${COL.docs}`}>
                  {collection.num_documents.toLocaleString()}
                </span>,
                <span key="chunks" className={`font-mono tabular-nums ${COL.chunks}`}>
                  {collection.num_chunks.toLocaleString()}
                </span>,
                <StatusDot
                  key="status"
                  tone={state.tone}
                  label={state.label}
                  className={COL.status}
                />,
                <Tooltip
                  key="updated"
                  content={parseApiDate(collection.updated_at)?.toLocaleString() ?? ""}
                  triggerClassName={`justify-end ${COL.updated}`}
                >
                  <span className="font-mono tabular-nums text-instrument text-meta">
                    {formatTimeAgoCompact(collection.updated_at)}
                  </span>
                </Tooltip>,
              ]}
              actions={
                <Tooltip content="Prune collection" side="left">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Prune ${collection.name}`}
                    className="hover:text-data-neg"
                    onClick={() => setPendingDelete(collection)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </Tooltip>
              }
            />
          );
        })
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
    </section>
  );
}
