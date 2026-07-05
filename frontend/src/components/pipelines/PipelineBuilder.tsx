"use client";

import { addEdge, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";

import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { useAuth } from "@/providers/auth-provider";

import { useCanvasDragDrop } from "./hooks/use-canvas-drag-drop";
import { useEmbeddingModelCatalog } from "./hooks/use-embedding-model-catalog";
import { usePineconeIndexes } from "./hooks/use-pinecone-indexes";
import { usePipelines } from "./hooks/use-pipelines";
import {
  validatePipelineConfig,
  validatePipelineConnection,
  validatePipelineEdges,
} from "./pipeline-io";
import { PIPELINE_KIND_STORAGE_KEY } from "./pipeline-kinds";
import {
  buildNodeCatalog,
  createDefaultNodePosition,
  createId,
  specToNodeData,
  toFlowEdges,
  toFlowNodes,
} from "./pipeline-utils";
import { PipelineCanvas } from "./PipelineCanvas";
import { PipelineHeader } from "./PipelineHeader";
import { PipelineInspector } from "./PipelineInspector";
import { PipelineModals } from "./PipelineModals";
import { PipelineRevisions } from "./PipelineRevisions";
import { PipelineSavePanel } from "./PipelineSavePanel";
import { PipelineSidebar } from "./PipelineSidebar";

import type { PipelineModalsHandle } from "./PipelineModals";
import type { PipelineNodeData } from "./PipelineNode";
import type { NodeSpec, PipelineKind } from "@/lib/types";
import type { Connection, Edge, Node, ReactFlowInstance } from "@xyflow/react";

type PipelineBuilderProps = {
  kind: PipelineKind;
};

const HIDDEN_NODE_TYPES = new Set(["chunker.collection"]);

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
    handleActivateVersion,
  } = usePipelines({ token, kind });

  const { embeddingModels, embeddingModelsLoading, embeddingModelsError } =
    useEmbeddingModelCatalog(token);

  const { indexes, indexesLoading, indexesError, refreshIndexes } = usePineconeIndexes(token);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PipelineNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewSpec, setPreviewSpec] = useState<NodeSpec | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    Node<PipelineNodeData>,
    Edge
  > | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>({});

  const modalsRef = useRef<PipelineModalsHandle>(null);

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
    () => nodeSpecs.filter((spec) => spec.category === kind && !HIDDEN_NODE_TYPES.has(spec.type)),
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
      position: position ?? createDefaultNodePosition(nodes.length),
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

  const nodesWithPreview = useMemo(() => {
    if (!dragDrop.dropPreviewPosition) return nodes;
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
    return [...nodes, dropPreviewNode as unknown as Node<PipelineNodeData>];
  }, [dragDrop.dropPreviewLabel, dragDrop.dropPreviewPosition, nodes]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(PIPELINE_KIND_STORAGE_KEY, kind);
  }, [kind]);

  useEffect(() => {
    if (!selectedPipeline || nodeSpecs.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    setNodes(toFlowNodes(selectedPipeline.definition, nodeSpecs));
    setEdges(toFlowEdges(selectedPipeline.definition));
    setSelectedNodeId(null);
    setPreviewSpec(null);
    dragDrop.handleDragLeave();
    // dragDrop.handleDragLeave is stable (useCallback with no deps in
    // useCanvasDragDrop) but isn't recognized as such by exhaustive-deps since it
    // comes from a custom hook, not a same-component useState/useCallback call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPipeline, nodeSpecs, setNodes, setEdges]);

  useEffect(() => {
    if (!inspectedNode) {
      setConfigDraft({});
      return;
    }
    setConfigDraft({ ...(inspectedNode.data.config ?? {}) });
  }, [inspectedNode]);

  const configOverrides = useMemo(() => {
    if (!selectedNode) return undefined;
    return { [selectedNode.id]: configDraft };
  }, [selectedNode, configDraft]);

  const { edgeErrors, nodeErrors } = useMemo(() => {
    const edgeValidation = validatePipelineEdges(nodes, edges, configOverrides);
    const configValidation = validatePipelineConfig(nodes, configOverrides);
    const mergedNodeErrors: Record<string, string[]> = { ...edgeValidation.nodeErrors };
    Object.entries(configValidation.nodeErrors).forEach(([nodeId, errors]) => {
      mergedNodeErrors[nodeId] = [...(mergedNodeErrors[nodeId] ?? []), ...errors];
    });
    return { edgeErrors: edgeValidation.edgeErrors, nodeErrors: mergedNodeErrors };
  }, [nodes, edges, configOverrides]);

  const validateConnection = (connection: Connection | Edge) =>
    validatePipelineConnection(connection, nodes, configOverrides);

  const handleConnect = (connection: Connection) => {
    const validation = validateConnection(connection);
    if (!validation.valid) {
      setMessage(validation.reason ?? "Invalid connection.");
      return;
    }
    setEdges((prev) =>
      addEdge(
        {
          ...connection,
          id: createId(),
          type: "smoothstep",
        },
        prev,
      ),
    );
  };

  const handleApplyConfig = () => {
    if (!selectedNode) return;
    const selectedErrors = nodeErrors[selectedNode.id] ?? [];
    if (selectedErrors.length > 0) {
      setMessage(selectedErrors[0]);
      return;
    }
    const nextConfig = { ...configDraft };
    setNodes((prev) =>
      prev.map((node) =>
        node.id === selectedNode.id
          ? { ...node, data: { ...node.data, config: nextConfig } }
          : node,
      ),
    );
    setMessage("Node configuration updated.");
  };

  const handleLabelChange = (label: string) => {
    if (!selectedNode) return;
    setNodes((prev) =>
      prev.map((node) =>
        node.id === selectedNode.id ? { ...node, data: { ...node.data, label } } : node,
      ),
    );
  };

  const handleSelectEmbeddingModel = async (modelId: string) => {
    if (!selectedNode || selectedNode.data.nodeType !== "embedder.openrouter") return;
    const selected = embeddingModels.find((model) => model.id === modelId);
    const nextDimension = selected?.dimension ?? undefined;
    setConfigDraft((prev) => {
      const next: Record<string, unknown> = { ...prev, model_name: modelId };
      if (typeof nextDimension === "number") {
        next.dimension = nextDimension;
      } else {
        delete next.dimension;
      }
      return next;
    });
  };

  const handlePreviewNode = (spec: NodeSpec) => {
    setPreviewSpec(spec);
    setSelectedNodeId(null);
  };

  const handleOpenIndexManager = (returnToWizard?: boolean) =>
    modalsRef.current?.openIndexManager(returnToWizard);

  const selectedNodeErrors = selectedNode ? (nodeErrors[selectedNode.id] ?? []) : [];
  const applyDisabled = selectedNodeErrors.length > 0;
  const edgesWithValidation = useMemo(
    () =>
      edges.map((edge) => {
        const error = edgeErrors[edge.id];
        if (!error) return edge;
        return {
          ...edge,
          className: `${edge.className ?? ""} pipeline-edge-error`.trim(),
          style: {
            ...edge.style,
            stroke: "#f87171",
            strokeWidth: 2,
          },
        };
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
            nodes={nodesWithPreview}
            edges={edgesWithValidation}
            selectedPipeline={selectedPipeline}
            notice={message}
            onNoticeDismiss={() => setMessage(null)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            isValidConnection={(connection) => validateConnection(connection).valid}
            onNodeSelect={(nodeId) => {
              setSelectedNodeId(nodeId);
              setPreviewSpec(null);
            }}
            onDrop={dragDrop.handleDrop}
            onDragOver={dragDrop.handleDragOver}
            onDragLeave={dragDrop.handleDragLeave}
            onInit={setReactFlowInstance}
          />

          <div className="flex min-h-0 flex-col gap-6 xl:overflow-y-auto">
            <PipelineInspector
              selectedNode={inspectedNode}
              configDraft={configDraft}
              onConfigDraftChange={isPreview ? () => undefined : setConfigDraft}
              onLabelChange={isPreview ? () => undefined : handleLabelChange}
              onApplyConfig={isPreview ? () => undefined : handleApplyConfig}
              isPreview={isPreview}
              validationErrors={selectedNodeErrors}
              applyDisabled={applyDisabled}
              pineconeIndexes={indexes}
              onOpenIndexManager={handleOpenIndexManager}
              embeddingModels={embeddingModels}
              embeddingModelsLoading={embeddingModelsLoading}
              embeddingModelsError={embeddingModelsError}
              onSelectEmbeddingModel={handleSelectEmbeddingModel}
            />

            <PipelineSavePanel
              changeSummary={changeSummary}
              onChangeSummary={setChangeSummary}
              onSave={() => handleSavePipeline(nodes, edges, nodeErrors)}
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
