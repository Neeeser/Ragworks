"use client";

import { useCallback, useEffect, useRef } from "react";

import { layoutPipelineNodes } from "../lib/pipeline-layout";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type { Pipeline, PipelineDefinition } from "@/lib/types";
import type { Node, ReactFlowInstance } from "@xyflow/react";

const LAYOUT_SAVE_DEBOUNCE_MS = 700;

type UseLayoutPersistenceParams = {
  selectedPipelineRef: React.RefObject<Pipeline | null>;
  nodesRef: React.RefObject<Node<PipelineNodeData>[]>;
  edgesRef: React.RefObject<TypedEdgeType[]>;
  setNodes: (updater: (nodes: Node<PipelineNodeData>[]) => Node<PipelineNodeData>[]) => void;
  reactFlowInstance: ReactFlowInstance<Node<PipelineNodeData>, TypedEdgeType> | null;
  persistLayout: (definition: PipelineDefinition) => Promise<void>;
};

type UseLayoutPersistenceResult = {
  /** Debounced: persist canvas node positions onto the saved definition. */
  scheduleLayoutSave: () => void;
  /** Re-run the layered auto-layout, refit the camera, and persist. */
  handleAutoLayout: () => void;
};

/**
 * Owns silent position persistence. Positions are grafted onto the SAVED
 * definition only -- unsaved material edits (new nodes, config changes) must
 * never ride along with a background layout save.
 */
export function useLayoutPersistence({
  selectedPipelineRef,
  nodesRef,
  edgesRef,
  setNodes,
  reactFlowInstance,
  persistLayout,
}: UseLayoutPersistenceParams): UseLayoutPersistenceResult {
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const scheduleLayoutSave = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const pipeline = selectedPipelineRef.current;
      if (!pipeline) return;
      const positions = new Map(
        (nodesRef.current ?? []).map((node) => [
          node.id,
          { x: node.position.x, y: node.position.y },
        ]),
      );
      let changed = false;
      const definition: PipelineDefinition = {
        ...pipeline.definition,
        nodes: pipeline.definition.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return node;
          if (node.position && node.position.x === position.x && node.position.y === position.y) {
            return node;
          }
          changed = true;
          return { ...node, position };
        }),
      };
      if (changed) {
        void persistLayout(definition);
      }
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }, [selectedPipelineRef, nodesRef, persistLayout]);

  const handleAutoLayout = useCallback(() => {
    setNodes((prev) => layoutPipelineNodes(prev, edgesRef.current ?? []));
    window.requestAnimationFrame(() => {
      reactFlowInstance?.fitView({ padding: 0.15, maxZoom: 1, duration: 300 });
    });
    scheduleLayoutSave();
  }, [setNodes, edgesRef, reactFlowInstance, scheduleLayoutSave]);

  return { scheduleLayoutSave, handleAutoLayout };
}
