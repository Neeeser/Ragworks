"use client";

import { useState } from "react";

import { TabList, tabId } from "@/components/ui/tabs";

import { PipelineCatalog } from "./PipelineCatalog";
import { PipelineNodeLibrary } from "./PipelineNodeLibrary";
import { VariablesPanel } from "./VariablesPanel";

import type { NodeFamily } from "./lib/pipeline-theme";
import type {
  CatalogModel,
  IndexBackend,
  NodeSpec,
  Pipeline,
  PipelineVariable,
  VectorIndex,
} from "@/lib/types";

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
  indexOptions: VectorIndex[];
  variablesDisabled: boolean;
  hasRerankingProvider: boolean;
  rerankingProviderMessage?: string | null;
  knownBackends: IndexBackend[];
};

/**
 * The editor's left rail: the pipelines in this kind plus the node library, or
 * the open pipeline's variables. It is a pane of the workspace card, not a card
 * of its own — a card inside a card is the nesting the console forbids.
 */
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
  indexOptions,
  variablesDisabled,
  hasRerankingProvider,
  rerankingProviderMessage,
  knownBackends,
}: PipelineSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>("pipelines");

  return (
    <>
      {/* No fixed height: the pill strip sizes to its own type, and clamping it
          clipped the selected pill's fill. */}
      <div className="flex shrink-0 items-center border-b border-hairline p-2">
        <TabList<SidebarTab>
          tabs={[
            { id: "pipelines", label: "Pipelines" },
            { id: "variables", label: "Variables" },
          ]}
          active={tab}
          onSelect={setTab}
          label="Sidebar sections"
          className="w-full"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
          <div role="tabpanel" aria-labelledby={tabId("variables")} className="p-2">
            <VariablesPanel
              variables={variables}
              onChange={onVariablesChange}
              nodes={variableNodes}
              modelOptions={modelOptions}
              indexOptions={indexOptions}
              disabled={variablesDisabled}
            />
          </div>
        )}
      </div>
    </>
  );
}
