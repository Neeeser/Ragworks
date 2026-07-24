"use client";

import { useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/providers/auth-provider";

import { useCanvasDecorations } from "./hooks/use-canvas-decorations";
import { useCanvasDragDrop } from "./hooks/use-canvas-drag-drop";
import { useConnectionTyping } from "./hooks/use-connection-typing";
import { useIndexBackends } from "./hooks/use-index-backends";
import { useIndexes } from "./hooks/use-indexes";
import { useLayoutPersistence } from "./hooks/use-layout-persistence";
import { useNodeEditing } from "./hooks/use-node-editing";
import { usePipelineModelCatalogs } from "./hooks/use-pipeline-model-catalogs";
import { usePipelines } from "./hooks/use-pipelines";
import { useSidebarWidth } from "./hooks/use-sidebar-width";
import { useTokenizerConsent } from "./hooks/use-tokenizer-consent";
import { useUnsavedChangesGuard } from "./hooks/use-unsaved-changes-guard";
import { diffDefinitions, materialChanges } from "./lib/pipeline-diff";
import { PIPELINE_KIND_STORAGE_KEY } from "./lib/pipeline-kinds";
import { layoutPipelineNodes, needsAutoLayout } from "./lib/pipeline-layout";
import {
  buildNodeCatalog,
  toFlowEdges,
  toFlowNodes,
  toPipelineDefinition,
} from "./lib/pipeline-utils";
import { RERANKER_NODE_TYPE, RERANKER_PROVIDER_REQUIRED } from "./lib/reranking";
import { NodeEditorDrawer } from "./NodeEditorDrawer";
import { PipelineBuilderWorkspace } from "./PipelineBuilderWorkspace";
import { PipelineEditorDialogs } from "./PipelineEditorDialogs";
import { PipelineHeader } from "./PipelineHeader";
import { PipelineModals } from "./PipelineModals";
import { TokenizerConsentDialog } from "./TokenizerConsentDialog";

import type { TypedEdgeType } from "./flow/TypedEdge";
import type { PipelineModalsHandle } from "./PipelineModals";
import type { PipelineNodeData } from "./PipelineNode";
import type { NodeSpec, PipelineKind, PipelineVariable } from "@/lib/types";
import type { Node, ReactFlowInstance } from "@xyflow/react";

type PipelineBuilderProps = {
  kind: PipelineKind;
};

const previewWithRerankerGate = (
  spec: NodeSpec,
  hasRerankingProvider: boolean,
  rerankingProviderMessage: string | null,
  previewNodeSpec: (candidate: NodeSpec) => void,
  setMessage: (message: string | null) => void,
) => {
  if (spec.type === RERANKER_NODE_TYPE && !hasRerankingProvider) {
    setMessage(rerankingProviderMessage ?? RERANKER_PROVIDER_REQUIRED);
    return;
  }
  previewNodeSpec(spec);
};

export function PipelineBuilder({ kind }: PipelineBuilderProps) {
  const { token, user } = useAuth();

  const {
    pipelines,
    nodeSpecs,
    versions,
    selectedPipeline,
    setSelectedPipeline,
    loading,
    saving,
    validating,
    validationIssues,
    clearValidationIssues,
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
  const tokenizerConsent = useTokenizerConsent(token, setMessage);

  const {
    embeddingModels,
    embeddingModelsLoading,
    embeddingModelsError,
    embeddingCatalog,
    rerankingModels,
    rerankingModelsLoading,
    rerankingModelsError,
    rerankingCatalog,
    hasRerankingProvider,
    rerankingProviderMessage,
    onEmbeddingCatalogVisible,
    onRerankingCatalogVisible,
    onRetryRerankingModels,
  } = usePipelineModelCatalogs(token, user?.id);

  const { indexes, indexesLoading, indexesError, refreshIndexes } = useIndexes(token);
  const { backends } = useIndexBackends(token);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PipelineNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TypedEdgeType>([]);
  const [variables, setVariables] = useState<PipelineVariable[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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

  const {
    selectedNode,
    previewSpec,
    inspectedNode,
    isPreview,
    selectNode,
    previewNodeSpec,
    closeEditor,
    addNode,
    applyNodeEdits,
  } = useNodeEditing({ nodes, setNodes });

  // Every non-hidden node is available in every editor — what a pipeline can
  // do is derived from its graph, so the library never gates by kind (an
  // indexer inside a tool pipeline is a legitimate build).
  const catalogSpecs = useMemo(() => nodeSpecs.filter((spec) => !spec.hidden), [nodeSpecs]);
  const catalogByFamily = useMemo(() => buildNodeCatalog(catalogSpecs), [catalogSpecs]);

  // `dragDrop` is referenced inside `handleAddNode`'s body below but declared after it;
  // this is safe because handleAddNode only reads `dragDrop` when invoked (from an event
  // handler), by which point this render has already assigned it via closure.
  const handleAddNode = (spec: NodeSpec, position?: { x: number; y: number }) => {
    addNode(spec, position);
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

  const handlePreviewNode = useCallback(
    (spec: NodeSpec) =>
      previewWithRerankerGate(
        spec,
        hasRerankingProvider,
        rerankingProviderMessage,
        previewNodeSpec,
        setMessage,
      ),
    [hasRerankingProvider, previewNodeSpec, rerankingProviderMessage, setMessage],
  );

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
    dragDrop.handleDragLeave();
    // The camera re-fits via PipelineCanvas's remount key (id+version), which
    // waits for the freshly mounted nodes to be measured.
    // dragDrop.handleDragLeave is intentionally omitted: it is stable. Keyed
    // on id + version so layout-only saves don't reset in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPipelineId, selectedPipelineVersion, nodeSpecs, setNodes, setEdges, closeEditor]);

  const pendingChanges = useMemo(() => {
    if (!selectedPipeline) return [];
    return diffDefinitions(
      selectedPipeline.definition,
      toPipelineDefinition(nodes, edges, variables),
    );
  }, [selectedPipeline, nodes, edges, variables]);
  const pendingMaterialChanges = useMemo(() => materialChanges(pendingChanges), [pendingChanges]);
  const dirty = pendingMaterialChanges.length > 0;

  const { guard, confirmOpen, confirmDiscard, cancelDiscard } = useUnsavedChangesGuard(dirty);
  const sidebar = useSidebarWidth();

  const variableNodes = useMemo(
    () => nodes.map((node) => ({ type: node.data.nodeType, config: node.data.config })),
    [nodes],
  );

  const handleSelectPipeline = (pipeline: typeof selectedPipeline) => {
    if (pipeline?.id === selectedPipeline?.id) return;
    guard(() => setSelectedPipeline(pipeline));
  };

  const { connecting, validateConnection, handleConnect, handleConnectStart, handleConnectEnd } =
    useConnectionTyping({
      nodes,
      edges,
      setEdges,
      onInvalidConnection: setMessage,
    });

  const { nodeErrors, nodesForCanvas, edgesWithValidation } = useCanvasDecorations({
    nodes,
    edges,
    connecting,
    validationIssues,
    dropPreviewPosition: dragDrop.dropPreviewPosition,
    dropPreviewLabel: dragDrop.dropPreviewLabel,
  });

  const { scheduleLayoutSave, handleAutoLayout } = useLayoutPersistence({
    selectedPipelineRef,
    nodesRef,
    edgesRef,
    setNodes,
    reactFlowInstance,
    persistLayout,
  });

  const handleOpenIndexManager = (returnToWizard?: boolean) =>
    modalsRef.current?.openIndexManager(returnToWizard);

  const handleOpenSave = () => {
    const validationErrors = Object.values(nodeErrors).flat();
    if (validationErrors.length > 0) {
      setMessage(validationErrors[0]);
      return;
    }
    setMessage(null);
    setSaveDialogOpen(true);
  };

  const handleSave = async () => {
    const fallbackSummary = pendingMaterialChanges
      .slice(0, 3)
      .map((change) => change.summary)
      .join("; ");
    const definition = toPipelineDefinition(nodes, edges, variables);
    await tokenizerConsent.ensureThen(definition, async () => {
      const saved = await handleSavePipeline(definition, fallbackSummary);
      if (saved) setSaveDialogOpen(false);
    });
  };

  const selectedNodeErrors = selectedNode ? (nodeErrors[selectedNode.id] ?? []) : [];
  const selectedValidationIssues = selectedNode
    ? validationIssues.filter((issue) => issue.node_id === selectedNode.id)
    : [];

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
        embeddingCatalog={embeddingCatalog}
        embeddingModelsLoading={embeddingModelsLoading}
        embeddingModelsError={embeddingModelsError}
        onCatalogVisible={onEmbeddingCatalogVisible}
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
        unsavedCount={pendingMaterialChanges.length}
        onOpenSave={handleOpenSave}
        onOpenHistory={() => setHistoryOpen(true)}
        hasPipeline={Boolean(selectedPipeline)}
      />

      <PipelineBuilderWorkspace
        loading={loading}
        resize={sidebar}
        sidebar={{
          pipelines,
          selectedPipelineId: selectedPipeline?.id,
          catalog: catalogByFamily,
          onSelectPipeline: handleSelectPipeline,
          onDeletePipeline: handleDeletePipeline,
          pipelineUsage,
          onPreviewNode: handlePreviewNode,
          variables,
          onVariablesChange: setVariables,
          variableNodes,
          modelOptions: embeddingModels,
          variablesDisabled: !selectedPipeline,
          hasRerankingProvider,
          rerankingProviderMessage,
        }}
        canvas={{
          canvasKey: `${selectedPipelineId ?? "none"}-v${selectedPipelineVersion}`,
          nodes: nodesForCanvas,
          edges: edgesWithValidation,
          selectedPipeline,
          notice: message,
          onNoticeDismiss: () => setMessage(null),
          onNodesChange,
          onEdgesChange,
          onConnect: handleConnect,
          onConnectStart: handleConnectStart,
          onConnectEnd: handleConnectEnd,
          isValidConnection: (connection) => validateConnection(connection).valid,
          onNodeSelect: selectNode,
          onNodeDragStop: scheduleLayoutSave,
          onAutoLayout: handleAutoLayout,
          onDrop: dragDrop.handleDrop,
          onDragOver: dragDrop.handleDragOver,
          onDragLeave: dragDrop.handleDragLeave,
          onInit: setReactFlowInstance,
        }}
      />

      <NodeEditorDrawer
        node={inspectedNode}
        onClose={closeEditor}
        onApply={(nodeId, edits) => {
          clearValidationIssues();
          applyNodeEdits(nodeId, edits);
        }}
        isPreview={isPreview}
        onAddToCanvas={previewSpec ? () => handleAddNode(previewSpec) : undefined}
        validationErrors={selectedNodeErrors}
        validationIssues={selectedValidationIssues}
        variables={variables}
        vectorIndexes={indexes}
        onOpenIndexManager={handleOpenIndexManager}
        embeddingModels={embeddingModels}
        embeddingCatalog={embeddingCatalog}
        embeddingModelsLoading={embeddingModelsLoading}
        embeddingModelsError={embeddingModelsError}
        onCatalogVisible={onEmbeddingCatalogVisible}
        rerankingModels={rerankingModels}
        rerankingCatalog={rerankingCatalog}
        rerankingModelsLoading={rerankingModelsLoading}
        rerankingModelsError={rerankingModelsError}
        onRerankingCatalogVisible={onRerankingCatalogVisible}
        onRetryRerankingModels={onRetryRerankingModels}
        hasRerankingProvider={hasRerankingProvider}
        rerankingProviderMessage={rerankingProviderMessage}
      />

      <PipelineEditorDialogs
        saveOpen={saveDialogOpen}
        onCloseSave={() => setSaveDialogOpen(false)}
        pendingChanges={pendingMaterialChanges}
        changeSummary={changeSummary}
        onChangeSummary={setChangeSummary}
        onSave={() => void handleSave()}
        saving={saving || validating}
        validationMessage={saveDialogOpen ? message : null}
        validationIssues={validationIssues}
        historyOpen={historyOpen}
        onCloseHistory={() => setHistoryOpen(false)}
        versions={versions}
        currentVersion={selectedPipeline?.current_version}
        activating={saving}
        onActivate={handleActivateVersion}
        discardOpen={confirmOpen}
        onConfirmDiscard={confirmDiscard}
        onCancelDiscard={cancelDiscard}
      />
      <TokenizerConsentDialog
        modelId={tokenizerConsent.modelId}
        remember={tokenizerConsent.remember}
        loading={tokenizerConsent.loading}
        onRememberChange={tokenizerConsent.setRemember}
        onConfirm={() => void tokenizerConsent.confirm()}
        onCancel={tokenizerConsent.cancel}
      />
    </div>
  );
}
