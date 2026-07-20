"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { DatasetDocumentsTable } from "@/components/evals/DatasetDocumentsTable";
import {
  DATASET_DOCS_PAGE_SIZE,
  useDatasetDetail,
} from "@/components/evals/hooks/use-dataset-detail";
import { GlassCard } from "@/components/ui/panel";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * One dataset's ingested corpora: a section per provisioned eval collection
 * (one per ingestion pipeline definition) with a paged, searchable document
 * list and per-document ingestion traces.
 */
export function DatasetDetail({ datasetId }: { datasetId: string }) {
  const {
    dataset,
    collections,
    collectionsLoading,
    pipelines,
    selected,
    selectCollection,
    search,
    setSearch,
    documents,
    offset,
    setOffset,
  } = useDatasetDetail(datasetId);

  if (dataset.error) {
    return <p className="text-sm text-data-neg">{dataset.error}</p>;
  }
  if (!dataset.data) {
    return <p className="text-sm text-muted">Loading dataset…</p>;
  }
  const detail = dataset.data;
  const pipelineName = (id: string | null | undefined) =>
    (pipelines.data ?? []).find((pipeline) => pipeline.id === id)?.name ?? "Unknown pipeline";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href="/evals"
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted transition hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Evals
        </Link>
        <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-primary">
          {detail.name}
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          {detail.num_corpus_docs.toLocaleString()} corpus docs ·{" "}
          {detail.num_queries.toLocaleString()} queries
        </p>
      </div>

      <GlassCard className="rounded-3xl border border-hairline bg-surface p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Ingested corpora
        </p>
        {collections.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            {collectionsLoading
              ? "Loading collections…"
              : "No runs have ingested this dataset yet. Each ingestion pipeline gets its own collection here after its first run."}
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  aria-pressed={selected?.id === collection.id}
                  className={cn(
                    "rounded-2xl border px-4 py-2 text-left text-sm transition focus-visible:ring-2 focus-visible:ring-accent-violet",
                    selected?.id === collection.id
                      ? "border-strong bg-surface-strong text-primary"
                      : "border-hairline text-body hover:border-strong",
                  )}
                  onClick={() => selectCollection(collection.id)}
                >
                  <span className="block font-medium">
                    {pipelineName(collection.ingestion_pipeline_id)}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] text-muted">
                    {collection.num_ready_documents.toLocaleString()} of{" "}
                    {detail.num_corpus_docs.toLocaleString()} docs ingested
                  </span>
                </button>
              ))}
            </div>
            {selected && (
              <DatasetDocumentsTable
                datasetId={datasetId}
                page={documents.data ?? null}
                loading={documents.loading}
                error={
                  documents.error
                    ? getErrorMessage(documents.error, "Could not load documents")
                    : null
                }
                search={search}
                onSearch={setSearch}
                offset={offset}
                pageSize={DATASET_DOCS_PAGE_SIZE}
                onOffset={setOffset}
              />
            )}
          </>
        )}
      </GlassCard>
    </div>
  );
}
