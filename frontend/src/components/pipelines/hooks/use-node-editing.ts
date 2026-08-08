"use client";

import { useCallback, useMemo, useState } from "react";

import { withNodeConfig } from "../lib/dynamic-ports";
import { hasUnsetRequiredSetting } from "../lib/node-required-settings";
import { createId, nextNodePosition, specToNodeData } from "../lib/pipeline-utils";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { NodeEdits } from "../NodeEditorDrawer";
import type { PipelineNodeData } from "../PipelineNode";
import type { NodeSpec } from "@/lib/types";
import type { Node } from "@xyflow/react";

interface UseNodeEditingParams {
  nodes: Node<PipelineNodeData>[];
  setNodes: (updater: (prev: Node<PipelineNodeData>[]) => Node<PipelineNodeData>[]) => void;
  setEdges: (updater: (prev: TypedEdgeType[]) => TypedEdgeType[]) => void;
}

/** A node's config as edited in the drawer but not yet applied to the canvas. */
export type NodeDraft = { nodeId: string; config: Record<string, unknown> };

/** Selection state with exactly `nodeId` selected; the same array when already so. */
const selectOnly = (nodes: Node<PipelineNodeData>[], nodeId: string) => {
  const wanted = (node: Node<PipelineNodeData>) => node.id === nodeId;
  if (nodes.every((node) => Boolean(node.selected) === wanted(node))) return nodes;
  return nodes.map((node) =>
    Boolean(node.selected) === wanted(node) ? node : { ...node, selected: wanted(node) },
  );
};

/**
 * Owns which node the editor drawer shows and the mutations that flow out of
 * it: adding, deleting, and applying a saved draft (label + config).
 *
 * Selecting a node and inspecting it are separate states. Selection is React
 * Flow's own (`node.selected`), which is what the canvas paints the ring and
 * the floating toolbar from; the inspector tracks its own node id, so a click
 * that merely selects no longer throws a full-height drawer over the graph.
 */
export function useNodeEditing({ nodes, setNodes, setEdges }: UseNodeEditingParams) {
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(null);
  const [previewSpec, setPreviewSpec] = useState<NodeSpec | null>(null);

  const selectedNode = useMemo(() => nodes.find((node) => node.selected) ?? null, [nodes]);
  const inspectedCanvasNode = useMemo(
    () => nodes.find((node) => node.id === inspectedNodeId) ?? null,
    [nodes, inspectedNodeId],
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
  const inspectedNode = previewNode ?? inspectedCanvasNode;
  const isPreview = Boolean(previewNode);

  // The open drawer's uncommitted config. Held here rather than merged into
  // `nodes` so the canvas does not re-render on every keystroke in a text box;
  // only live validation reads it.
  const [nodeDraft, setNodeDraft] = useState<NodeDraft | null>(null);

  /** A click on a node: React Flow has already selected it, so only the
   *  library preview standing in the drawer's place needs clearing. */
  const selectNode = useCallback(() => setPreviewSpec(null), []);

  const openNode = useCallback(
    (nodeId: string) => {
      setPreviewSpec(null);
      setInspectedNodeId(nodeId);
      setNodes((prev) => selectOnly(prev, nodeId));
    },
    [setNodes],
  );

  const previewNodeSpec = useCallback((spec: NodeSpec) => {
    setPreviewSpec(spec);
    setInspectedNodeId(null);
  }, []);

  /** Closes the drawer but leaves the node selected, so its toolbar returns. */
  const closeEditor = useCallback(() => {
    setInspectedNodeId(null);
    setPreviewSpec(null);
    setNodeDraft(null);
  }, []);

  const addNode = useCallback(
    (spec: NodeSpec, position?: { x: number; y: number }) => {
      const nodeId = createId();
      const data = specToNodeData(spec);
      const newNode: Node<PipelineNodeData> = {
        id: nodeId,
        type: "pipelineNode",
        position: position ?? nextNodePosition(nodes),
        data,
        selected: true,
      };
      setNodes((prev) => [...selectOnly(prev, nodeId), newNode]);
      setPreviewSpec(null);
      // A node that landed fully configured needs nothing from the drawer, and
      // opening one over the canvas hides the graph the user is building. One
      // that cannot run until a model or index is named opens on the decision
      // it is waiting for.
      setInspectedNodeId(hasUnsetRequiredSetting(data) ? nodeId : null);
    },
    [nodes, setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((prev) => prev.filter((node) => node.id !== nodeId));
      setEdges((prev) => prev.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      setInspectedNodeId((current) => (current === nodeId ? null : current));
      setNodeDraft((current) => (current?.nodeId === nodeId ? null : current));
    },
    [setEdges, setNodes],
  );

  /** A node removed by React Flow itself (the Delete key) must not leave the
   *  drawer open on a node that no longer exists. */
  const handleNodesDeleted = useCallback((deleted: Array<{ id: string }>) => {
    const ids = new Set(deleted.map((node) => node.id));
    setInspectedNodeId((current) => (current && ids.has(current) ? null : current));
    setNodeDraft((current) => (current && ids.has(current.nodeId) ? null : current));
  }, []);

  const applyNodeEdits = useCallback(
    (nodeId: string, edits: NodeEdits) => {
      setNodeDraft(null);
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId
            ? { ...node, data: withNodeConfig({ ...node.data, label: edits.label }, edits.config) }
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
    inspectedCanvasNode,
    isPreview,
    selectNode,
    openNode,
    previewNodeSpec,
    closeEditor,
    addNode,
    deleteNode,
    handleNodesDeleted,
    applyNodeEdits,
    nodeDraft,
    setNodeDraft,
  };
}
