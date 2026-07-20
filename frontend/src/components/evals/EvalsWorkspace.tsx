"use client";

import { useState } from "react";

import { CollectionsPanel } from "@/components/evals/CollectionsPanel";
import { DatasetsPanel } from "@/components/evals/DatasetsPanel";
import { useEvalsWorkspace } from "@/components/evals/hooks/use-evals-workspace";
import { NewRunWizard } from "@/components/evals/NewRunWizard";
import { RunsPanel } from "@/components/evals/RunsPanel";

export function EvalsWorkspace() {
  const workspace = useEvalsWorkspace();
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Evals</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-primary">
          Retrieval evaluation
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-body">
          Run a benchmark or your own dataset against an ingestion and retrieval pipeline pair.
          Metrics score the retrieved documents against the dataset&apos;s relevance judgments; the
          trace funnel shows which node lost them.
        </p>
      </div>

      {workspace.actionError && (
        <p role="alert" className="text-sm text-data-neg">
          {workspace.actionError}
        </p>
      )}

      <RunsPanel
        runs={workspace.runs.data ?? []}
        datasets={workspace.datasets.data ?? []}
        metricCatalog={workspace.metricCatalog.data ?? []}
        loading={workspace.runs.loading}
        onNewRun={() => setWizardOpen(true)}
        onDeleteRun={workspace.removeRun}
      />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <DatasetsPanel
          datasets={workspace.datasets.data ?? []}
          benchmarks={workspace.benchmarks.data ?? []}
          loading={workspace.datasets.loading}
          onImport={workspace.importBenchmark}
          onUpload={workspace.uploadDataset}
          onDelete={workspace.removeDataset}
        />
        <CollectionsPanel
          collections={workspace.collections.data ?? []}
          datasets={workspace.datasets.data ?? []}
          pipelines={workspace.pipelines.data ?? []}
          loading={workspace.collections.loading}
          onDelete={workspace.removeCollection}
        />
      </div>

      {/* Mounted per open so every launch starts from a clean wizard state. */}
      {wizardOpen && (
        <NewRunWizard
          open
          datasets={workspace.datasets.data ?? []}
          pipelines={workspace.pipelines.data ?? []}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
