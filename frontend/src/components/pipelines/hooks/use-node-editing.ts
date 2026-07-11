"use client";

import { useCallback, useMemo, useState } from "react";

import { createId, nextNodePosition, specToNodeData } from "../lib/pipeline-utils";

import type { NodeEdits } from "../NodeEditorDrawer";
import type { PipelineNodeData } from "../PipelineNode";
import type { NodeSpec } from "@/lib/types";
import type { Node } from "@xyflow/react";

interface UseNodeEditingParams {
  nodes: Node<PipelineNodeData>[];
  setNodes: (updater: (prev: Node<PipelineNodeData>[]) => Node<PipelineNodeData>[]) => void;
}

/**
 * Owns which node the editor drawer shows (a selected canvas node or a
 * read-only library preview) and the mutations that flow out of the drawer:
 * adding a node and applying a saved draft (label + config) to a node.
 */
export function useNodeEditing({ nodes, setNodes }: UseNodeEditingParams) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewSpec, setPreviewSpec] = useState<NodeSpec | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const previewNode = useMemo(() => {
    if (!previewSpec) return null;
    const node: Node<PipelineNodeData> = {
      id: `preview-${previewSpec.type}`,
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: specToNodeData(previewSpec),
    };
    return node;
  }, [previewSpec]);
  const inspectedNode = previewNode ?? selectedNode;
  const isPreview = Boolean(previewNode);

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setPreviewSpec(null);
  }, []);

  const previewNodeSpec = useCallback((spec: NodeSpec) => {
    setPreviewSpec(spec);
    setSelectedNodeId(null);
  }, []);

  const closeEditor = useCallback(() => {
    setSelectedNodeId(null);
    setPreviewSpec(null);
  }, []);

  const addNode = useCallback(
    (spec: NodeSpec, position?: { x: number; y: number }) => {
      const nodeId = createId();
      const newNode: Node<PipelineNodeData> = {
        id: nodeId,
        type: "pipelineNode",
        position: position ?? nextNodePosition(nodes),
        data: specToNodeData(spec),
      };
      setNodes((prev) => [...prev, newNode]);
      setSelectedNodeId(nodeId);
      setPreviewSpec(null);
    },
    [nodes, setNodes],
  );

  const applyNodeEdits = useCallback(
    (nodeId: string, edits: NodeEdits) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, label: edits.label, config: edits.config } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  return {
    selectedNode,
    previewSpec,
    inspectedNode,
    isPreview,
    selectNode,
    previewNodeSpec,
    closeEditor,
    addNode,
    applyNodeEdits,
  };
}
