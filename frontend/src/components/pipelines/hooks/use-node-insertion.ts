"use client";

import { useCallback, useMemo } from "react";

import { useModelShortlist } from "@/components/models/hooks/use-model-shortlist";

import { withSeededChatModel } from "../lib/llm-model-seed";
import {
  previewWithRerankerGate,
  RERANKER_NODE_TYPE,
  RERANKER_PROVIDER_REQUIRED,
} from "../lib/reranking";

import { useCanvasDragDrop } from "./use-canvas-drag-drop";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type { UseCanvasDragDropResult } from "./use-canvas-drag-drop";
import type { CatalogModel, NodeSpec } from "@/lib/types";
import type { Node, ReactFlowInstance } from "@xyflow/react";

type UseNodeInsertionParams = {
  catalogSpecs: NodeSpec[];
  reactFlowInstance: ReactFlowInstance<Node<PipelineNodeData>, TypedEdgeType> | null;
  /** The chat catalog LLM nodes pick from; a seed must still be served by it. */
  llmModels: CatalogModel[];
  hasRerankingProvider: boolean;
  rerankingProviderMessage?: string | null;
  addNode: (spec: NodeSpec, position?: { x: number; y: number }) => void;
  previewNodeSpec: (spec: NodeSpec) => void;
  setMessage: (message: string | null) => void;
};

export type UseNodeInsertionResult = {
  /** Add a node (catalog, preset, drawer preview, or canvas drop) to the graph. */
  addNode: (spec: NodeSpec, position?: { x: number; y: number }) => void;
  /** Open a catalog entry read-only, subject to the reranking-provider gate. */
  previewNode: (spec: NodeSpec) => void;
  dragDrop: UseCanvasDragDropResult;
};

/**
 * Every way a node reaches the canvas, in one place: the catalog's Add, a
 * preset, the preview drawer, and a drag from the library.
 *
 * Sharing one entry point is what lets the model seed apply everywhere rather
 * than to whichever surface remembered it.
 */
export function useNodeInsertion({
  catalogSpecs,
  reactFlowInstance,
  llmModels,
  hasRerankingProvider,
  rerankingProviderMessage,
  addNode,
  previewNodeSpec,
  setMessage,
}: UseNodeInsertionParams): UseNodeInsertionResult {
  // The shortlist the model pickers already render from — one source, so the
  // seed is the same "most recent" the user sees when they open the picker.
  // Entries whose model has left the catalog are skipped: seeding one would
  // put a model on the node that its own picker refuses to offer.
  const { recent } = useModelShortlist("chat", llmModels);
  const recentChatModel = useMemo(() => {
    const match = recent.find((item) => item.model !== null);
    return match
      ? { connectionId: match.entry.connection_id, modelId: match.entry.model_id }
      : null;
  }, [recent]);

  // `dragDrop` is referenced inside `handleAddNode`'s body below but declared
  // after it; safe because handleAddNode only reads it when invoked (from an
  // event handler), by which point this render has assigned it via closure.
  const handleAddNode = (spec: NodeSpec, position?: { x: number; y: number }) => {
    addNode(withSeededChatModel(spec, recentChatModel), position);
    dragDrop.handleDragLeave();
  };

  const dragDrop = useCanvasDragDrop({
    catalogSpecs,
    reactFlowInstance,
    onAddNode: handleAddNode,
    onUnknownNodeType: () => setMessage("Unable to add node: unknown type."),
    canAddNode: (spec) => spec.type !== RERANKER_NODE_TYPE || hasRerankingProvider,
    onUnavailableNodeType: () => setMessage(rerankingProviderMessage ?? RERANKER_PROVIDER_REQUIRED),
  });

  const previewNode = useCallback(
    (spec: NodeSpec) =>
      previewWithRerankerGate(
        spec,
        hasRerankingProvider,
        rerankingProviderMessage ?? null,
        previewNodeSpec,
        setMessage,
      ),
    [hasRerankingProvider, previewNodeSpec, rerankingProviderMessage, setMessage],
  );

  return { addNode: handleAddNode, previewNode, dragDrop };
}
