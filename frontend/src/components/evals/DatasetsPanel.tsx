"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { GenerateDatasetWizard } from "@/components/evals/GenerateDatasetWizard";
import { ImportBenchmarkDialog } from "@/components/evals/ImportBenchmarkDialog";
import { UploadDatasetDialog } from "@/components/evals/UploadDatasetDialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type {
  BuiltinDatasetInfo,
  CatalogModel,
  Collection,
  EvalDataset,
  EvalDatasetGeneratePayload,
  EvalDatasetUploadPayload,
} from "@/lib/types";

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

const IN_FLIGHT_TONE = "bg-accent-violet";

const STATUS_TONE: Record<EvalDataset["status"], string> = {
  pending: IN_FLIGHT_TONE,
  downloading: IN_FLIGHT_TONE,
  generating: IN_FLIGHT_TONE,
  ready: "bg-data-pos",
  failed: "bg-data-neg",
};

const SOURCE_LABEL: Record<EvalDataset["source"], string> = {
  builtin_benchmark: "benchmark",
  custom_upload: "upload",
  synthetic: "synthetic",
};

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
    <GlassCard className="rounded-3xl border border-hairline bg-surface p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Datasets</p>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button variant="secondary" onClick={() => setGenerateOpen(true)}>
            Generate from collection
          </Button>
          <Button variant="secondary" onClick={() => setUploadOpen(true)}>
            Upload dataset
          </Button>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import benchmark
          </Button>
        </div>
      </div>
      {datasets.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          {loading ? (
            "Loading datasets…"
          ) : (
            <>
              No datasets. Import a vetted benchmark or upload your own in BEIR format
              (corpus.jsonl, queries.jsonl, qrels TSV) —{" "}
              <Link
                href="/evals/datasets/format"
                className="text-accent-cyan underline-offset-4 hover:underline"
              >
                file formats and examples
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[color:var(--border-hairline)]">
          {datasets.map((dataset) => (
            <li key={dataset.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/evals/datasets/${dataset.id}`}
                    className="truncate font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent-violet"
                  >
                    {dataset.name}
                  </Link>
                  {dataset.source_ref && domainByKey.has(dataset.source_ref) && (
                    <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent-cyan">
                      {domainByKey.get(dataset.source_ref)}
                    </p>
                  )}
                </div>
                {dataset.description && (
                  <p className="mt-1 truncate text-sm text-body">{dataset.description}</p>
                )}
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                  {dataset.status === "generating"
                    ? `${dataset.progress_done} of ${dataset.progress_total} questions accepted`
                    : `${dataset.num_queries.toLocaleString()} queries · ` +
                      `${dataset.num_corpus_docs.toLocaleString()} docs · ` +
                      SOURCE_LABEL[dataset.source]}
                </p>
                {dataset.status === "failed" && dataset.error_message && (
                  <p className="mt-1 text-xs text-data-neg">{dataset.error_message}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                  <span
                    aria-hidden
                    className={cn("h-1.5 w-1.5 rounded-full", STATUS_TONE[dataset.status])}
                  />
                  {dataset.status}
                </span>
                <button
                  type="button"
                  aria-label={`Delete dataset ${dataset.name}`}
                  className="rounded-full p-2 text-muted transition hover:bg-surface-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
                  onClick={() => setPendingDelete(dataset)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
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
    </GlassCard>
  );
}
