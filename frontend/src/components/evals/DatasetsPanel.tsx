"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { GenerateDatasetWizard } from "@/components/evals/GenerateDatasetWizard";
import { ImportBenchmarkDialog } from "@/components/evals/ImportBenchmarkDialog";
import { datasetStatus, SOURCE_LABEL } from "@/components/evals/lib/status";
import { UploadDatasetDialog } from "@/components/evals/UploadDatasetDialog";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataRow, DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { PulseWire } from "@/components/ui/pulse-wire";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";

import type {
  BuiltinDatasetInfo,
  CatalogModel,
  Collection,
  EvalDataset,
  EvalDatasetGeneratePayload,
  EvalDatasetUploadPayload,
} from "@/lib/types";
import type { ReactNode } from "react";

interface DatasetsPanelProps {
  datasets: EvalDataset[];
  benchmarks: BuiltinDatasetInfo[];
  collections: Collection[];
  chatModels: CatalogModel[];
  loading: boolean;
  onImport: (key: string) => Promise<boolean>;
  onUpload: (payload: EvalDatasetUploadPayload) => Promise<boolean>;
  onGenerate: (payload: EvalDatasetGeneratePayload) => Promise<boolean>;
  onDelete: (datasetId: string) => Promise<boolean>;
}

/** Column widths shared by the header, the rows, and the loading placeholder. */
const COL = {
  queries: "w-16 text-right",
  docs: "w-16 text-right",
  source: "hidden w-20 lg:block",
  status: "w-24",
};

function ColumnHeader() {
  return (
    <DataRowHeader
      hasLeading
      title="Dataset"
      columns={[
        <InstrumentLabel key="queries" className={COL.queries}>
          Queries
        </InstrumentLabel>,
        <InstrumentLabel key="docs" className={COL.docs}>
          Docs
        </InstrumentLabel>,
        <InstrumentLabel key="source" className={COL.source}>
          Source
        </InstrumentLabel>,
        <InstrumentLabel key="status" className={COL.status}>
          Status
        </InstrumentLabel>,
      ]}
    />
  );
}

/**
 * A dataset's second line: the failure that stopped it, the count of questions
 * a generator has accepted so far, its description, or nothing at all. Never a
 * placeholder — a row with nothing to add stays one line tall.
 */
function datasetSubtitle(dataset: EvalDataset): ReactNode {
  if (dataset.status === "failed" && dataset.error_message) {
    return <span className="text-data-neg">{dataset.error_message}</span>;
  }
  if (dataset.status === "generating") {
    return (
      <span className="flex items-center gap-3">
        <span className="font-mono tabular-nums text-instrument">
          {dataset.progress_done} of {dataset.progress_total} questions accepted
        </span>
        {/* Licensed: the generator is producing questions right now. */}
        <PulseWire label={`Generating ${dataset.name}`} className="w-20" />
      </span>
    );
  }
  return dataset.description?.trim() || undefined;
}

export function DatasetsPanel({
  datasets,
  benchmarks,
  collections,
  chatModels,
  loading,
  onImport,
  onUpload,
  onGenerate,
  onDelete,
}: DatasetsPanelProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EvalDataset | null>(null);
  const importedKeys = new Set(
    datasets
      .filter((dataset) => dataset.source === "builtin_benchmark" && dataset.source_ref)
      .map((dataset) => dataset.source_ref as string),
  );
  const domainByKey = new Map(benchmarks.map((benchmark) => [benchmark.key, benchmark.domain]));

  return (
    <section aria-label="Datasets" className="card-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <h2 className="text-head font-semibold tracking-[-0.01em] text-primary">Datasets</h2>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => setGenerateOpen(true)}>
            Generate from collection
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setUploadOpen(true)}>
            Upload dataset
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
            Import benchmark
          </Button>
        </div>
      </div>

      <ColumnHeader />

      {loading ? (
        <DataRowSkeleton
          label="Loading datasets"
          hasLeading
          columnWidths={[COL.queries, COL.docs, COL.source, COL.status]}
        />
      ) : datasets.length === 0 ? (
        <div className="p-8 text-center">
          <p className="mx-auto max-w-[66ch] text-ui text-muted">
            No datasets yet. Import a vetted benchmark, generate one from a collection, or upload
            your own corpus, queries, and relevance judgments in BEIR format.
          </p>
          <ButtonLink href="/evals/datasets/format" className="mt-3">
            Dataset format
          </ButtonLink>
        </div>
      ) : (
        datasets.map((dataset) => {
          const state = datasetStatus(dataset.status);
          const domain = dataset.source_ref ? domainByKey.get(dataset.source_ref) : undefined;
          return (
            <DataRow
              key={dataset.id}
              href={`/evals/datasets/${dataset.id}`}
              leading={<StatusDot tone={state.tone} />}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{dataset.name}</span>
                  {/* A benchmark's subject area — a fact with no state, so the
                      chip is neutral and carries no dot. */}
                  {domain ? (
                    <Chip tone="neutral" dot={false}>
                      {domain}
                    </Chip>
                  ) : null}
                </span>
              }
              subtitle={datasetSubtitle(dataset)}
              columns={[
                <span key="queries" className={`font-mono tabular-nums ${COL.queries}`}>
                  {dataset.num_queries.toLocaleString()}
                </span>,
                <span key="docs" className={`font-mono tabular-nums ${COL.docs}`}>
                  {dataset.num_corpus_docs.toLocaleString()}
                </span>,
                <span key="source" className={`truncate text-instrument text-muted ${COL.source}`}>
                  {SOURCE_LABEL[dataset.source]}
                </span>,
                <StatusDot
                  key="status"
                  tone={state.tone}
                  label={state.label}
                  className={COL.status}
                />,
              ]}
              actions={
                <Tooltip content="Delete dataset" side="left">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete dataset ${dataset.name}`}
                    className="hover:text-data-neg"
                    onClick={() => setPendingDelete(dataset)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </Tooltip>
              }
            />
          );
        })
      )}

      <ImportBenchmarkDialog
        open={importOpen}
        benchmarks={benchmarks}
        importedKeys={importedKeys}
        onImport={onImport}
        onClose={() => setImportOpen(false)}
      />
      <UploadDatasetDialog
        open={uploadOpen}
        onUpload={onUpload}
        onClose={() => setUploadOpen(false)}
      />
      {/* Mounted per open so every launch starts from a clean wizard state. */}
      {generateOpen && (
        <GenerateDatasetWizard
          open
          collections={collections}
          chatModels={chatModels}
          onGenerate={onGenerate}
          onClose={() => setGenerateOpen(false)}
        />
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete dataset"
        description={
          pendingDelete?.status === "generating"
            ? `Stop generating and delete ${pendingDelete?.name ?? "this dataset"}.`
            : `Delete ${pendingDelete?.name ?? "this dataset"} and its stored corpus, queries, and judgments. Runs referencing it must be deleted first.`
        }
        confirmLabel="Delete dataset"
        confirmVariant="danger"
        onConfirm={async () => {
          if (pendingDelete) await onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
