"use client";

import { useState } from "react";

import { GlassCard } from "@/components/ui/panel";
import { TabList, tabId } from "@/components/ui/tabs";

import { PipelineCatalog } from "./PipelineCatalog";
import { PipelineNodeLibrary } from "./PipelineNodeLibrary";
import { VariablesPanel } from "./VariablesPanel";

import type { NodeFamily } from "./lib/pipeline-theme";
import type { CatalogModel, IndexBackend, NodeSpec, Pipeline, PipelineVariable } from "@/lib/types";

type SidebarTab = "pipelines" | "variables";

type PipelineSidebarProps = {
  pipelines: Pipeline[];
  selectedPipelineId?: string;
  catalog: Array<{ family: NodeFamily; specs: NodeSpec[] }>;
  onSelectPipeline: (pipeline: Pipeline) => void;
  onDeletePipeline: (pipeline: Pipeline) => void;
  pipelineUsage: Set<string>;
  onPreviewNode: (spec: NodeSpec) => void;
  variables: PipelineVariable[];
  onVariablesChange: (variables: PipelineVariable[]) => void;
  variableNodes: Array<{ type: string; config: Record<string, unknown> }>;
  modelOptions: CatalogModel[];
  variablesDisabled: boolean;
  hasRerankingProvider: boolean;
  rerankingProviderMessage?: string | null;
  knownBackends: IndexBackend[];
};

export function PipelineSidebar({
  pipelines,
  selectedPipelineId,
  catalog,
  onSelectPipeline,
  onDeletePipeline,
  pipelineUsage,
  onPreviewNode,
  variables,
  onVariablesChange,
  variableNodes,
  modelOptions,
  variablesDisabled,
  hasRerankingProvider,
  rerankingProviderMessage,
  knownBackends,
}: PipelineSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>("pipelines");

  return (
    <GlassCard className="rounded-3xl p-5 xl:h-full xl:overflow-y-auto">
      <TabList<SidebarTab>
        tabs={[
          { id: "pipelines", label: "Pipelines" },
          { id: "variables", label: "Variables" },
        ]}
        active={tab}
        onSelect={setTab}
        label="Sidebar sections"
        className="mb-4"
      />
      {tab === "pipelines" ? (
        <div role="tabpanel" aria-labelledby={tabId("pipelines")}>
          <PipelineCatalog
            pipelines={pipelines}
            selectedPipelineId={selectedPipelineId}
            onSelect={onSelectPipeline}
            onDelete={onDeletePipeline}
            pipelineUsage={pipelineUsage}
          />
          <PipelineNodeLibrary
            catalog={catalog}
            onPreviewNode={onPreviewNode}
            hasRerankingProvider={hasRerankingProvider}
            rerankingProviderMessage={rerankingProviderMessage}
            knownBackends={knownBackends}
          />
        </div>
      ) : (
        <div role="tabpanel" aria-labelledby={tabId("variables")}>
          <VariablesPanel
            variables={variables}
            onChange={onVariablesChange}
            nodes={variableNodes}
            modelOptions={modelOptions}
            disabled={variablesDisabled}
          />
        </div>
      )}
    </GlassCard>
  );
}
