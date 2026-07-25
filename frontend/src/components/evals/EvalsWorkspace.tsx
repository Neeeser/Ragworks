"use client";

import { useState } from "react";

import { CollectionsPanel } from "@/components/evals/CollectionsPanel";
import { DatasetsPanel } from "@/components/evals/DatasetsPanel";
import { useEvalsWorkspace } from "@/components/evals/hooks/use-evals-workspace";
import { NewRunWizard } from "@/components/evals/NewRunWizard";
import { RunsPanel } from "@/components/evals/RunsPanel";
import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { PanelGrid } from "@/components/ui/panel";

/**
 * The evals landing page: runs across the top, then the datasets they measure
 * against beside the benchmark corpora they ingested into.
 *
 * No title block and no feature blurb — the breadcrumb owns the identity, and
 * what a run actually does is said once, in the runs list's empty state, where
 * a user who has never made one is looking.
 */
export function EvalsWorkspace() {
  const workspace = useEvalsWorkspace();
  const [wizardOpen, setWizardOpen] = useState(false);

  const runs = workspace.runs.data ?? [];
  const datasets = workspace.datasets.data ?? [];
  const pipelines = workspace.pipelines.data ?? [];
  const benchmarks = workspace.benchmarks.data ?? [];
  const evalCollections = workspace.collections.data ?? [];
  const userCollections = workspace.userCollections.data ?? [];
  const chatModels = workspace.chatModels.data?.models ?? [];
  const metricCatalog = workspace.metricCatalog.data ?? [];

  return (
    <>
      <CrumbBar
        crumbs={[{ label: "Evals" }]}
        state={
          workspace.runs.loading ? null : (
            <InstrumentLabel>
              {`${runs.length} ${runs.length === 1 ? "run" : "runs"} · ${datasets.length} ${
                datasets.length === 1 ? "dataset" : "datasets"
              }`}
            </InstrumentLabel>
          )
        }
        actions={
          <Button size="sm" glow onClick={() => setWizardOpen(true)}>
            New run
          </Button>
        }
      />

      <PageBody className="flex flex-col gap-3">
        {workspace.actionError && (
          <p role="alert" className="text-ui text-data-neg">
            {workspace.actionError}
          </p>
        )}

        <RunsPanel
          runs={runs}
          datasets={datasets}
          metricCatalog={metricCatalog}
          loading={workspace.runs.loading}
          onNewRun={() => setWizardOpen(true)}
          onDeleteRun={workspace.removeRun}
        />

        <PanelGrid columns={2} className="items-start">
          <DatasetsPanel
            datasets={datasets}
            benchmarks={benchmarks}
            collections={userCollections}
            chatModels={chatModels}
            loading={workspace.datasets.loading}
            onImport={workspace.importBenchmark}
            onUpload={workspace.uploadDataset}
            onGenerate={workspace.generateDataset}
            onDelete={workspace.removeDataset}
          />
          <CollectionsPanel
            collections={evalCollections}
            datasets={datasets}
            pipelines={pipelines}
            loading={workspace.collections.loading}
            onDelete={workspace.removeCollection}
          />
        </PanelGrid>
      </PageBody>

      {/* Mounted per open so every launch starts from a clean wizard state. */}
      {wizardOpen && (
        <NewRunWizard
          open
          datasets={datasets}
          pipelines={pipelines}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </>
  );
}
