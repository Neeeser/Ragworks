"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { readEditorIntent } from "../lib/editor-intent";

import type { PipelineEditorHandle } from "../lib/pipeline-editor-context";
import type { PipelineNodeData } from "../PipelineNode";
import type { Pipeline } from "@/lib/types";
import type { Node } from "@xyflow/react";

type UsePipelineDeepLinkParams = {
  pipelines: Pipeline[];
  /** The canvas's current nodes; the drawer can only open once they exist. */
  nodes: Node<PipelineNodeData>[];
  /**
   * Seeding path — no unsaved-changes guard. The link is spent while the
   * editor is still resolving its first pipeline, where the canvas is empty
   * and the "dirty" comparison against it is meaningless.
   */
  seedPipeline: (pipeline: Pipeline) => void;
  /** Mid-session path — goes through the unsaved-changes guard. */
  switchPipeline: (pipeline: Pipeline) => void;
  openNode: (nodeId: string) => void;
};

/**
 * Opens the pipeline and node a `?pipeline=&node=` link names, and exposes the
 * same move to surfaces mounted over the editor.
 *
 * Both paths land through `pendingNodeId` rather than opening the node
 * outright: rebuilding the canvas for a newly selected pipeline closes the
 * editor drawer, so an open made before the nodes exist is wiped. Waiting
 * for the node to appear is a render-time adjustment, not an effect — the
 * drawer opens in the same paint as the graph.
 */
export function usePipelineDeepLink({
  pipelines,
  nodes,
  seedPipeline,
  switchPipeline,
  openNode,
}: UsePipelineDeepLinkParams): PipelineEditorHandle["openNode"] {
  const searchParams = useSearchParams();
  const [intent, setIntent] = useState(() => readEditorIntent(searchParams));
  const [pendingNodeId, setPendingNodeId] = useState<string | null>(null);

  // Spent as soon as the catalog has loaded, whether or not it named a
  // pipeline this editor holds. Re-applying it on a later load would drag the
  // user back off whatever they opened after arriving.
  if (intent && pipelines.length > 0) {
    const target = pipelines.find((pipeline) => pipeline.id === intent.pipelineId);
    setIntent(null);
    if (target) {
      seedPipeline(target);
      if (intent.nodeId) setPendingNodeId(intent.nodeId);
    }
  }

  if (pendingNodeId && nodes.some((node) => node.id === pendingNodeId)) {
    setPendingNodeId(null);
    openNode(pendingNodeId);
  }

  return useCallback(
    (pipelineId: string, nodeId: string) => {
      const target = pipelines.find((pipeline) => pipeline.id === pipelineId);
      if (!target) return false;
      // A no-op when it is already the open pipeline, which is the common
      // case: the prompt being edited belongs to a node on this canvas.
      switchPipeline(target);
      setPendingNodeId(nodeId);
      return true;
    },
    [pipelines, switchPipeline],
  );
}
