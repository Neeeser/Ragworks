"use client";

import { useEffect, useRef } from "react";

import { layoutPipelineNodes, needsAutoLayout } from "../lib/pipeline-layout";
import { toFlowEdges, toFlowNodes } from "../lib/pipeline-utils";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type { NodeSpec, Pipeline, PipelineVariable } from "@/lib/types";
import type { Node } from "@xyflow/react";

type UseCanvasSeedingParams = {
  selectedPipeline: Pipeline | null;
  nodeSpecs: NodeSpec[];
  setNodes: (nodes: Node<PipelineNodeData>[]) => void;
  setEdges: (edges: TypedEdgeType[]) => void;
  setVariables: (variables: PipelineVariable[]) => void;
  closeEditor: () => void;
  /** Clears any in-flight drop ghost; stable, so it stays out of the deps. */
  clearDropPreview: () => void;
};

/**
 * Rebuilds the canvas from the selected pipeline's active revision.
 *
 * Keyed on id + revision rather than the pipeline object's identity: silent
 * layout saves and background refetches hand back a fresh object for unchanged
 * content, and reseeding on those would wipe the user's in-progress edits.
 */
export function useCanvasSeeding({
  selectedPipeline,
  nodeSpecs,
  setNodes,
  setEdges,
  setVariables,
  closeEditor,
  clearDropPreview,
}: UseCanvasSeedingParams): void {
  const selectedPipelineId = selectedPipeline?.id ?? null;
  const selectedPipelineVersion = selectedPipeline?.current_version ?? 0;
  const pipelineRef = useRef(selectedPipeline);
  pipelineRef.current = selectedPipeline;

  useEffect(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline || nodeSpecs.length === 0 || pipeline.id !== selectedPipelineId) {
      setNodes([]);
      setEdges([]);
      setVariables([]);
      return;
    }
    let flowNodes = toFlowNodes(pipeline.definition, nodeSpecs);
    const flowEdges = toFlowEdges(pipeline.definition, nodeSpecs);
    if (needsAutoLayout(flowNodes)) {
      flowNodes = layoutPipelineNodes(flowNodes, flowEdges);
    }
    setNodes(flowNodes);
    setEdges(flowEdges);
    setVariables(pipeline.definition.variables ?? []);
    closeEditor();
    clearDropPreview();
    // The camera re-fits via PipelineCanvas's remount key (id+version), which
    // waits for the freshly mounted nodes to be measured. `clearDropPreview`
    // is intentionally omitted: it is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPipelineId, selectedPipelineVersion, nodeSpecs, setNodes, setEdges, closeEditor]);
}
