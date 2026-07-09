"use client";

import { useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { useAuth } from "@/providers/auth-provider";

import { useCanvasDragDrop } from "./hooks/use-canvas-drag-drop";
import { useConnectionTyping } from "./hooks/use-connection-typing";
import { useEmbeddingModelCatalog } from "./hooks/use-embedding-model-catalog";
import { useIndexBackends } from "./hooks/use-index-backends";
import { useIndexes } from "./hooks/use-indexes";
import { useLayoutPersistence } from "./hooks/use-layout-persistence";
import { usePipelines } from "./hooks/use-pipelines";
import { diffDefinitions, materialChanges } from "./lib/pipeline-diff";
import { validatePipelineConfig, validatePipelineEdges } from "./lib/pipeline-io";
import { PIPELINE_KIND_STORAGE_KEY } from "./lib/pipeline-kinds";
import { layoutPipelineNodes, needsAutoLayout } from "./lib/pipeline-layout";
import {
  buildNodeCatalog,
  createId,
  nextNodePosition,
  specToNodeData,
  toFlowEdges,
  toFlowNodes,
  toPipelineDefinition,
} from "./lib/pipeline-utils";
import { PipelineCanvas } from "./PipelineCanvas";
import { PipelineHeader } from "./PipelineHeader";
import { PipelineInspector } from "./PipelineInspector";
import { PipelineModals } from "./PipelineModals";
import { PipelineRevisions } from "./PipelineRevisions";
import { PipelineSavePanel } from "./PipelineSavePanel";
import { PipelineSidebar } from "./PipelineSidebar";

import type { TypedEdgeType } from "./flow/TypedEdge";
import type { PipelineModalsHandle } from "./PipelineModals";
import type { PipelineNodeData } from "./PipelineNode";
import type { NodeSpec, PipelineKind } from "@/lib/types";
import type { Node, ReactFlowInstance } from "@xyflow/react";

type PipelineBuilderProps = {
  kind: PipelineKind;
};

export function PipelineBuilder({ kind }: PipelineBuilderProps) {
  const { token } = useAuth();

  const {
    pipelines,
    nodeSpecs,
    versions,
    selectedPipeline,
    setSelectedPipeline,
    loading,
    saving,
    validating,
    message,
    setMessage,
    changeSummary,
    setChangeSummary,
    pipelineUsage,
    deleteTarget,
    handlePipelineCreated,
    handleDeletePipeline,
    cancelDeletePipeline,
    handleConfirmDelete,
    handleSavePipeline,
    persistLayout,
    handleActivateVersion,
  } = usePipelines({ token, kind });

  const { embeddingModels, embeddingModelsLoading, embeddingModelsError } =
    useEmbeddingModelCatalog(token);

  const { indexes, indexesLoading, indexesError, refreshIndexes } = useIndexes(token);
  const { backends } = useIndexBackends(token);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PipelineNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TypedEdgeType>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewSpec, setPreviewSpec] = useState<NodeSpec | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    Node<PipelineNodeData>,
    TypedEdgeType
  > | null>(null);

  const modalsRef = useRef<PipelineModalsHandle>(null);
  const autoOpenedWizard = useRef(false);
  // Latest nodes/edges for callbacks that must read fresh state without
  // re-creating themselves (layout save debounce, auto-layout).
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

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

  const catalogSpecs = useMemo(
    () => nodeSpecs.filter((spec) => spec.category === kind && !spec.hidden),
    [nodeSpecs, kind],
  );
  const catalogByFamily = useMemo(() => buildNodeCatalog(catalogSpecs), [catalogSpecs]);

  // `dragDrop` is referenced inside `handleAddNode`'s body below but declared after it;
  // this is safe because handleAddNode only reads `dragDrop` when invoked (from an event
  // handler), by which point this render has already assigned it via closure.
  const handleAddNode = (spec: NodeSpec, position?: { x: number; y: number }) => {
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
    dragDrop.handleDragLeave();
  };

  const dragDrop = useCanvasDragDrop({
    catalogSpecs,
    reactFlowInstance,
    onAddNode: handleAddNode,
    onUnknownNodeType: () => setMessage("Unable to add node: unknown type."),
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(PIPELINE_KIND_STORAGE_KEY, kind);
  }, [kind]);

  // Open the creation wizard for first-time visitors with no pipelines yet.
  useEffect(() => {
    if (loading || pipelines.length > 0 || autoOpenedWizard.current) return;
    autoOpenedWizard.current = true;
    modalsRef.current?.openCreatePipeline();
  }, [loading, pipelines.length]);

  const selectedPipelineId = selectedPipeline?.id ?? null;
  const selectedPipelineVersion = selectedPipeline?.current_version ?? 0;
  const selectedPipelineRef = useRef(selectedPipeline);
  selectedPipelineRef.current = selectedPipeline;

  // Rebuild the canvas when the pipeline (or its active revision) changes --
  // deliberately NOT on every `selectedPipeline` object identity change, so
  // silent layout saves don't wipe in-progress edits.
  useEffect(() => {
    const pipeline = selectedPipelineRef.current;
    if (!pipeline || nodeSpecs.length === 0 || pipeline.id !== selectedPipelineId) {
      setNodes([]);
      setEdges([]);
      return;
    }
    let flowNodes = toFlowNodes(pipeline.definition, nodeSpecs);
    const flowEdges = toFlowEdges(pipeline.definition, nodeSpecs);
    if (needsAutoLayout(flowNodes)) {
      flowNodes = layoutPipelineNodes(flowNodes, flowEdges);
    }
    setNodes(flowNodes);
    setEdges(flowEdges);
    setSelectedNodeId(null);
    setPreviewSpec(null);
    dragDrop.handleDragLeave();
    // The camera re-fits via PipelineCanvas's remount key (id+version), which
    // waits for the freshly mounted nodes to be measured.
    // dragDrop.handleDragLeave is intentionally omitted: it is stable. Keyed
    // on id + version so layout-only saves don't reset in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPipelineId, selectedPipelineVersion, nodeSpecs, setNodes, setEdges]);

  const { edgeErrors, nodeErrors } = useMemo(() => {
    const edgeValidation = validatePipelineEdges(nodes, edges);
    const configValidation = validatePipelineConfig(nodes);
    const mergedNodeErrors: Record<string, string[]> = { ...edgeValidation.nodeErrors };
    Object.entries(configValidation.nodeErrors).forEach(([nodeId, errors]) => {
      mergedNodeErrors[nodeId] = [...(mergedNodeErrors[nodeId] ?? []), ...errors];
    });
    return { edgeErrors: edgeValidation.edgeErrors, nodeErrors: mergedNodeErrors };
  }, [nodes, edges]);

  const pendingChanges = useMemo(() => {
    if (!selectedPipeline) return [];
    return diffDefinitions(selectedPipeline.definition, toPipelineDefinition(nodes, edges));
  }, [selectedPipeline, nodes, edges]);
  const pendingMaterialChanges = useMemo(() => materialChanges(pendingChanges), [pendingChanges]);

  const { connecting, validateConnection, handleConnect, handleConnectStart, handleConnectEnd } =
    useConnectionTyping({
      nodes,
      setEdges,
      onInvalidConnection: setMessage,
    });

  const { scheduleLayoutSave, handleAutoLayout } = useLayoutPersistence({
    selectedPipelineRef,
    nodesRef,
    edgesRef,
    setNodes,
    reactFlowInstance,
    persistLayout,
  });

  const handleNodeConfigChange = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, config } } : node,
        ),
      );
    },
    [setNodes],
  );

  const handleLabelChange = (label: string) => {
    if (!selectedNode) return;
    setNodes((prev) =>
      prev.map((node) =>
        node.id === selectedNode.id ? { ...node, data: { ...node.data, label } } : node,
      ),
    );
  };

  const handleSelectEmbeddingModel = (modelId: string) => {
    if (!selectedNode || selectedNode.data.nodeType !== "embedder.openrouter") return;
    // Deliberately set only the model — and clear any stored dimension: an
    // explicit `dimension` is sent to OpenRouter as a `dimensions` override,
    // which most embedding models reject (no matryoshka support). Models emit
    // their native size without it.
    const nextConfig: Record<string, unknown> = {
      ...selectedNode.data.config,
      model_name: modelId,
    };
    delete nextConfig.dimension;
    handleNodeConfigChange(selectedNode.id, nextConfig);
  };

  const handlePreviewNode = (spec: NodeSpec) => {
    setPreviewSpec(spec);
    setSelectedNodeId(null);
  };

  const handleOpenIndexManager = (returnToWizard?: boolean) =>
    modalsRef.current?.openIndexManager(returnToWizard);

  const handleSave = () => {
    const validationErrors = Object.values(nodeErrors).flat();
    if (validationErrors.length > 0) {
      setMessage(validationErrors[0]);
      return;
    }
    const fallbackSummary = pendingMaterialChanges
      .slice(0, 3)
      .map((change) => change.summary)
      .join("; ");
    void handleSavePipeline(toPipelineDefinition(nodes, edges), fallbackSummary);
  };

  const selectedNodeErrors = selectedNode ? (nodeErrors[selectedNode.id] ?? []) : [];

  const nodesForCanvas = useMemo(() => {
    const decorated = nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        connecting,
        errors: nodeErrors[node.id],
      },
    }));
    if (!dragDrop.dropPreviewPosition) return decorated;
    const dropPreviewNode = {
      id: "drop-preview",
      type: "dropPreview",
      position: dragDrop.dropPreviewPosition,
      data: { label: dragDrop.dropPreviewLabel ?? "Drop here" },
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    } satisfies Node;
    // The drop-preview node carries DropPreviewNodeData, not PipelineNodeData; xyflow
    // dispatches rendering by `type`, so the heterogeneous array is safe at runtime even
    // though it can't be expressed without a discriminated Node union across this module.
    return [...decorated, dropPreviewNode as unknown as Node<PipelineNodeData>];
  }, [nodes, connecting, nodeErrors, dragDrop.dropPreviewLabel, dragDrop.dropPreviewPosition]);

  const edgesWithValidation = useMemo(
    () =>
      edges.map((edge) => {
        const error = edgeErrors[edge.id];
        if (!error) return edge;
        return { ...edge, data: { ...edge.data, error: true } };
      }),
    [edges, edgeErrors],
  );

  return (
    <div className="flex h-full flex-col gap-6">
      <PipelineModals
        ref={modalsRef}
        kind={kind}
        token={token ?? ""}
        indexes={indexes}
        backends={backends}
        nodeSpecs={nodeSpecs}
        embeddingModels={embeddingModels}
        embeddingModelsLoading={embeddingModelsLoading}
        embeddingModelsError={embeddingModelsError}
        indexesLoading={indexesLoading}
        indexesError={indexesError}
        onRefreshIndexes={refreshIndexes}
        onPipelineCreated={handlePipelineCreated}
        deleteTarget={deleteTarget}
        saving={saving}
        onConfirmDelete={handleConfirmDelete}
        onCancelDelete={cancelDeletePipeline}
      />
      <PipelineHeader
        kind={kind}
        onCreatePipeline={() => modalsRef.current?.openCreatePipeline()}
        onManageIndexes={() => handleOpenIndexManager()}
      />

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <GlassCard className="flex items-center justify-center rounded-3xl p-10">
            <Loader className="h-6 w-6" />
          </GlassCard>
        </div>
      ) : (
        <div className="grid flex-1 min-h-0 gap-6 xl:grid-cols-[280px_1fr_320px]">
          <div className="min-h-0">
            <PipelineSidebar
              pipelines={pipelines}
              selectedPipelineId={selectedPipeline?.id}
              catalog={catalogByFamily}
              onSelectPipeline={setSelectedPipeline}
              onDeletePipeline={handleDeletePipeline}
              pipelineUsage={pipelineUsage}
              onPreviewNode={handlePreviewNode}
            />
          </div>

          <PipelineCanvas
            canvasKey={`${selectedPipelineId ?? "none"}-v${selectedPipelineVersion}`}
            nodes={nodesForCanvas}
            edges={edgesWithValidation}
            selectedPipeline={selectedPipeline}
            notice={message}
            onNoticeDismiss={() => setMessage(null)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onConnectStart={handleConnectStart}
            onConnectEnd={handleConnectEnd}
            isValidConnection={(connection) => validateConnection(connection).valid}
            onNodeSelect={(nodeId) => {
              setSelectedNodeId(nodeId);
              setPreviewSpec(null);
            }}
            onNodeDragStop={scheduleLayoutSave}
            onAutoLayout={handleAutoLayout}
            onDrop={dragDrop.handleDrop}
            onDragOver={dragDrop.handleDragOver}
            onDragLeave={dragDrop.handleDragLeave}
            onInit={setReactFlowInstance}
          />

          <div className="flex min-h-0 flex-col gap-6 xl:overflow-y-auto">
            <PipelineInspector
              selectedNode={inspectedNode}
              onConfigChange={
                isPreview
                  ? () => undefined
                  : (config) => selectedNode && handleNodeConfigChange(selectedNode.id, config)
              }
              onLabelChange={isPreview ? () => undefined : handleLabelChange}
              isPreview={isPreview}
              validationErrors={selectedNodeErrors}
              vectorIndexes={indexes}
              onOpenIndexManager={handleOpenIndexManager}
              embeddingModels={embeddingModels}
              embeddingModelsLoading={embeddingModelsLoading}
              embeddingModelsError={embeddingModelsError}
              onSelectEmbeddingModel={handleSelectEmbeddingModel}
            />

            <PipelineSavePanel
              changeSummary={changeSummary}
              onChangeSummary={setChangeSummary}
              pendingChanges={pendingMaterialChanges}
              onSave={handleSave}
              saving={saving}
              validating={validating}
            />

            <PipelineRevisions
              versions={versions}
              currentVersion={selectedPipeline?.current_version}
              saving={saving}
              onActivate={handleActivateVersion}
            />
          </div>
        </div>
      )}
    </div>
  );
}
