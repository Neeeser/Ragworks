"use client";

import { CorpusRetryAction } from "@/components/evals/CorpusRetryAction";
import { DatasetDocumentsTable } from "@/components/evals/DatasetDocumentsTable";
import { DatasetQueriesTable } from "@/components/evals/DatasetQueriesTable";
import {
  DATASET_DOCS_PAGE_SIZE,
  useDatasetDetail,
} from "@/components/evals/hooks/use-dataset-detail";
import { readGenerationCoverage } from "@/components/evals/lib/generation-stats";
import { datasetStatus, SOURCE_LABEL } from "@/components/evals/lib/status";
import { PageBody } from "@/components/ui/app-shell";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { KpiCell, KpiStrip } from "@/components/ui/kpi-strip";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PulseWire } from "@/components/ui/pulse-wire";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
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
    reloadCollections,
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
    return (
      <>
        <CrumbBar crumbs={[{ label: "Evals", href: "/evals" }, { label: "Dataset" }]} />
        <PageBody>
          <p className="text-ui text-data-neg">{dataset.error}</p>
        </PageBody>
      </>
    );
  }

  if (!dataset.data) {
    return (
      <>
        <CrumbBar crumbs={[{ label: "Evals", href: "/evals" }, { label: "Dataset" }]} />
        <PageBody className="flex flex-col gap-3">
          {/* The page's final geometry: the same KPI strip, then its card. */}
          <KpiStrip>
            <KpiCell label="Corpus docs" loading />
            <KpiCell label="Queries" loading />
            <KpiCell label="Source" loading />
            <KpiCell label="Source docs covered" loading />
            <KpiCell label="Ingested corpora" loading />
          </KpiStrip>
          <Panel className="h-40" />
        </PageBody>
      </>
    );
  }

  const detail = dataset.data;
  const state = datasetStatus(detail.status);
  const coverage = readGenerationCoverage(detail);
  const pipelineName = (id: string | null | undefined) =>
    (pipelines.data ?? []).find((pipeline) => pipeline.id === id)?.name ?? "Unknown pipeline";

  return (
    <>
      <CrumbBar
        crumbs={[{ label: "Evals", href: "/evals" }, { label: detail.name }]}
        state={<StatusDot tone={state.tone} label={state.label} />}
      />

      <PageBody className="flex flex-col gap-3">
        {/* The dataset's own page, so its numbers lead — the breadcrumb already
            carries the name. */}
        <KpiStrip>
          <KpiCell label="Corpus docs" value={detail.num_corpus_docs} />
          <KpiCell label="Queries" value={detail.num_queries} />
          <KpiCell label="Source" value={SOURCE_LABEL[detail.source]} />
          {/* Synthetic datasets only. Absent elsewhere, so it renders an
              em-dash rather than a misleading zero. */}
          <KpiCell
            label="Source docs covered"
            value={coverage ? `${coverage.documentsCovered}/${coverage.documentsTotal}` : null}
            tooltip="How many of the source collection's documents the generated queries reach"
          />
          <KpiCell label="Ingested corpora" value={collections.length} />
        </KpiStrip>

        {detail.status === "generating" && (
          <Panel className="shrink-0 overflow-hidden">
            <PulseWire label={`Generating ${detail.name}`} className="w-full" />
            <p className="px-3 py-2 font-mono text-ui tabular-nums text-primary">
              {detail.progress_done}/{detail.progress_total}
              <span className="ml-2 text-instrument text-muted">questions accepted</span>
            </p>
          </Panel>
        )}

        {detail.status === "failed" && detail.error_message && (
          <p className="max-w-[66ch] text-ui text-data-neg">{detail.error_message}</p>
        )}

        {detail.status === "ready" && <DatasetQueriesTable datasetId={datasetId} />}

        <Panel className="shrink-0 overflow-hidden">
          <PanelHeader title="Ingested corpora" />

          {collections.length === 0 ? (
            collectionsLoading ? (
              <div className="space-y-2 p-3" aria-busy>
                <Skeleton className="h-2 max-w-48" />
                <Skeleton className="h-2 max-w-32" />
                <span className="sr-only">Loading ingested corpora</span>
              </div>
            ) : (
              <p className="p-8 text-center text-ui text-muted">
                No runs have ingested this dataset yet. Each ingestion pipeline gets its own
                collection here after its first run.
              </p>
            )
          ) : (
            <div className="flex flex-col lg:flex-row">
              {/* The navigating pane: `bg-surface` fill on top of the hairline
                  seam, so the two panes read as different rooms. */}
              <nav
                aria-label="Ingested corpora"
                className="shrink-0 border-b border-hairline bg-surface lg:w-64 lg:border-b-0 lg:border-r"
              >
                {collections.map((collection) => {
                  const active = selected?.id === collection.id;
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "block w-full border-b border-hairline px-3 py-2 text-left last:border-b-0",
                        "transition-colors duration-80 ease-standard focus-visible:outline-none",
                        "focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
                        active
                          ? "bg-accent-violet/10 text-primary"
                          : "text-body hover:bg-surface-strong",
                      )}
                      onClick={() => selectCollection(collection.id)}
                    >
                      <span className="block truncate text-ui font-medium">
                        {pipelineName(collection.ingestion_pipeline_id)}
                      </span>
                      {/* Mono for the counts only — in the console mono means
                          "this is data", so the word beside them stays sans. */}
                      <span className="mt-0.5 block text-instrument text-muted">
                        <span className="font-mono tabular-nums">
                          {collection.num_ready_documents.toLocaleString()}/
                          {detail.num_corpus_docs.toLocaleString()}
                        </span>{" "}
                        docs ingested
                      </span>
                    </button>
                  );
                })}
              </nav>

              <div className="min-w-0 flex-1">
                {selected ? (
                  <>
                    {selected.num_ready_documents < selected.num_documents && (
                      <div className="flex flex-col gap-2 border-b border-hairline p-3">
                        <p className="text-ui text-data-warn">
                          {selected.num_documents - selected.num_ready_documents} of{" "}
                          {selected.num_documents} materialized documents did not reach the index.
                          Queries whose gold is among them cannot be scored.
                        </p>
                        <CorpusRetryAction
                          collectionId={selected.id}
                          onQueued={() => {
                            reloadCollections();
                            documents.reload();
                          }}
                        />
                      </div>
                    )}
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
                  </>
                ) : null}
              </div>
            </div>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
