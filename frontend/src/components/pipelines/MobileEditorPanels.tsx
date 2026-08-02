"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { ModalOverlay } from "../ui/modal-overlay";

import { PipelineCatalog } from "./PipelineCatalog";
import { PipelineNodeLibrary } from "./PipelineNodeLibrary";
import { VariablesPanel } from "./VariablesPanel";

import type { PipelineSidebarProps } from "./PipelineSidebar";

type MobilePanel = "pipelines" | "nodes" | "variables";

const PANEL_LABELS: Record<MobilePanel, string> = {
  pipelines: "Pipelines",
  nodes: "Nodes",
  variables: "Variables",
};

type MobileEditorPanelsProps = PipelineSidebarProps;

/**
 * The editor's panels below `xl`: the canvas keeps the whole screen and a pill
 * row floating over its bottom edge opens each panel as a bottom sheet —
 * a drawer docked to its own edge, never a centered takeover. Selecting a
 * pipeline or previewing a node closes the sheet so the canvas answers the
 * action.
 */
export function MobileEditorPanels(props: MobileEditorPanelsProps) {
  const [panel, setPanel] = useState<MobilePanel | null>(null);
  const close = () => setPanel(null);

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center xl:hidden">
        <div className="pointer-events-auto flex gap-1 rounded-full border border-hairline bg-canvas-raised/95 p-1 shadow-elevation-2">
          {(Object.keys(PANEL_LABELS) as MobilePanel[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-haspopup="dialog"
              onClick={() => setPanel(id)}
              className={cn(
                "rounded-full px-3 py-1 text-instrument font-medium text-body transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
              )}
            >
              {PANEL_LABELS[id]}
            </button>
          ))}
        </div>
      </div>

      {panel ? (
        <ModalOverlay
          open
          onClose={close}
          labelledBy="pipeline-mobile-panel-title"
          backdropClassName="items-end p-0"
          dialogClassName="h-auto w-full"
        >
          <div className="flex h-[75dvh] w-full flex-col overflow-hidden rounded-t-panel border-t border-hairline bg-canvas-raised shadow-elevation-2">
            <div
              aria-hidden
              className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-surface-strong"
            />
            <h2 id="pipeline-mobile-panel-title" className="sr-only">
              {PANEL_LABELS[panel]}
            </h2>
            {panel === "pipelines" ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <PipelineCatalog
                  pipelines={props.pipelines}
                  selectedPipelineId={props.selectedPipelineId}
                  onSelect={(pipeline) => {
                    close();
                    props.onSelectPipeline(pipeline);
                  }}
                  onDelete={props.onDeletePipeline}
                  onCopy={props.onCopyPipeline}
                  pipelineUsage={props.pipelineUsage}
                />
              </div>
            ) : panel === "nodes" ? (
              <div className="min-h-0 flex-1">
                <PipelineNodeLibrary
                  catalog={props.catalog}
                  onPreviewNode={(spec) => {
                    close();
                    props.onPreviewNode(spec);
                  }}
                  onBrowseAll={() => {
                    close();
                    props.onBrowseAllNodes();
                  }}
                  hasRerankingProvider={props.hasRerankingProvider}
                  rerankingProviderMessage={props.rerankingProviderMessage}
                  knownBackends={props.knownBackends}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                <VariablesPanel
                  variables={props.variables}
                  onChange={props.onVariablesChange}
                  nodes={props.variableNodes}
                  modelOptions={props.modelOptions}
                  indexOptions={props.indexOptions}
                  disabled={props.variablesDisabled}
                />
              </div>
            )}
          </div>
        </ModalOverlay>
      ) : null}
    </>
  );
}
