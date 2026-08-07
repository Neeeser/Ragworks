"use client";

import { useState } from "react";

import { TabList, tabId } from "@/components/ui/tabs";

import { PipelineCatalog } from "./PipelineCatalog";
import { PipelineNodeLibrary } from "./PipelineNodeLibrary";
import { VariablesPanel } from "./VariablesPanel";

import type { NodeCatalogGroup } from "./lib/node-library-filter";
import type {
  CatalogModel,
  IndexBackend,
  NodeSpec,
  Pipeline,
  PipelineVariable,
  VectorIndex,
} from "@/lib/types";

type SidebarTab = "pipelines" | "nodes" | "variables";

export type PipelineSidebarProps = {
  pipelines: Pipeline[];
  selectedPipelineId?: string;
  catalog: NodeCatalogGroup[];
  onSelectPipeline: (pipeline: Pipeline) => void;
  onDeletePipeline: (pipeline: Pipeline) => void;
  onCopyPipeline: (pipeline: Pipeline) => void;
  pipelineUsage: Set<string>;
  onPreviewNode: (spec: NodeSpec) => void;
  onBrowseAllNodes: () => void;
  /** Canvas labels per node type, so search answers the name on the graph. */
  nodeInstanceLabels: Record<string, string[]>;
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
 * The editor's left rail: the pipeline catalog, the node library, or the open
 * pipeline's variables — one tab each. It is a pane of the workspace card, not
 * a card of its own — a card inside a card is the nesting the console forbids.
 */
export function PipelineSidebar({
  pipelines,
  selectedPipelineId,
  catalog,
  onSelectPipeline,
  onDeletePipeline,
  onCopyPipeline,
  pipelineUsage,
  onPreviewNode,
  onBrowseAllNodes,
  nodeInstanceLabels,
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
            { id: "nodes", label: "Nodes" },
            { id: "variables", label: "Variables" },
          ]}
          active={tab}
          onSelect={setTab}
          label="Sidebar sections"
          className="w-full"
        />
      </div>
      {/* The Nodes tab owns its own scroll (rail + panel), so the shared
          wrapper must not scroll — each panel manages its own overflow. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "pipelines" ? (
          <div
            role="tabpanel"
            aria-labelledby={tabId("pipelines")}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <PipelineCatalog
              pipelines={pipelines}
              selectedPipelineId={selectedPipelineId}
              onSelect={onSelectPipeline}
              onDelete={onDeletePipeline}
              onCopy={onCopyPipeline}
              pipelineUsage={pipelineUsage}
            />
          </div>
        ) : tab === "nodes" ? (
          <div role="tabpanel" aria-labelledby={tabId("nodes")} className="min-h-0 flex-1">
            <PipelineNodeLibrary
              catalog={catalog}
              onPreviewNode={onPreviewNode}
              onBrowseAll={onBrowseAllNodes}
              instanceLabels={nodeInstanceLabels}
              hasRerankingProvider={hasRerankingProvider}
              rerankingProviderMessage={rerankingProviderMessage}
              knownBackends={knownBackends}
            />
          </div>
        ) : (
          <div
            role="tabpanel"
            aria-labelledby={tabId("variables")}
            className="min-h-0 flex-1 overflow-y-auto p-2"
          >
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
