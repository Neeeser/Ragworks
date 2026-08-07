"use client";

import { useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useIndexes } from "@/components/indexes/use-indexes";
import { useAuth } from "@/providers/auth-provider";

import { useCanvasDecorations } from "./hooks/use-canvas-decorations";
import { useCanvasSeeding } from "./hooks/use-canvas-seeding";
import { useConnectionTyping } from "./hooks/use-connection-typing";
import { useExpectedEmbeddingDimension } from "./hooks/use-expected-embedding-dimension";
import { useIndexBackends } from "./hooks/use-index-backends";
import { useLayoutPersistence } from "./hooks/use-layout-persistence";
import { useLiveValidation } from "./hooks/use-live-validation";
import { useNodeEditing } from "./hooks/use-node-editing";
import { useNodeInsertion } from "./hooks/use-node-insertion";
import { usePipelineDeepLink } from "./hooks/use-pipeline-deep-link";
import { usePipelineModelCatalogs } from "./hooks/use-pipeline-model-catalogs";
import { usePipelines } from "./hooks/use-pipelines";
import { useSidebarWidth } from "./hooks/use-sidebar-width";
import { useTokenizerConsent } from "./hooks/use-tokenizer-consent";
import { useUnsavedChangesGuard } from "./hooks/use-unsaved-changes-guard";
import { instanceLabelsByType } from "./lib/node-library-filter";
import { diffDefinitions, materialChanges } from "./lib/pipeline-diff";
import { PipelineEditorContext } from "./lib/pipeline-editor-context";
import { PIPELINE_KIND_STORAGE_KEY } from "./lib/pipeline-kinds";
import { buildNodeCatalog, toPipelineDefinition } from "./lib/pipeline-utils";
import { collectSaveBlockers } from "./lib/save-blockers";
import { buildIndexVariable } from "./lib/variable-env";
import { NodeCatalogOverlay } from "./NodeCatalogOverlay";
import { NodeEditorDrawer } from "./NodeEditorDrawer";
import { PipelineBuilderWorkspace } from "./PipelineBuilderWorkspace";
import { PipelineEditorDialogs } from "./PipelineEditorDialogs";
import { PipelineHeader } from "./PipelineHeader";
import { PipelineModals } from "./PipelineModals";
import { TokenizerConsentDialog } from "./TokenizerConsentDialog";

import type { TypedEdgeType } from "./flow/TypedEdge";
import type { IndexVariableDeclaration } from "./lib/variable-env";
import type { PipelineModalsHandle } from "./PipelineModals";
import type { PipelineNodeData } from "./PipelineNode";
import type { PipelineKind, PipelineVariable } from "@/lib/types";
import type { Node, ReactFlowInstance } from "@xyflow/react";

type PipelineBuilderProps = {
  kind: PipelineKind;
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
    applyValidationIssues,
    message,
    setMessage,
    changeSummary,
    setChangeSummary,
    pipelineUsage,
    deleteTarget,
    handlePipelineCreated,
    handleDeletePipeline,
    handleCopyPipeline,
    handleRenamePipeline,
    cancelDeletePipeline,
    handleConfirmDelete,
    handleSavePipeline,
    persistLayout,
    handleActivateVersion,
  } = usePipelines({ token, kind });
  const tokenizerConsent = useTokenizerConsent(token, setMessage);

  // Kept whole: every field is a drawer prop of the same name, so spreading
  // it there beats restating the list in two places.
  const modelCatalogs = usePipelineModelCatalogs(token, user?.id);
  const { hasRerankingProvider, rerankingProviderMessage, wizardRerankingCatalog } = modelCatalogs;

  const { indexes, registeredIndexes, indexesLoading, indexesError, refreshIndexes } =
    useIndexes(token);
  const { backends } = useIndexBackends(token);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PipelineNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TypedEdgeType>([]);
  const [variables, setVariables] = useState<PipelineVariable[]>([]);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [nodeCatalogOpen, setNodeCatalogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    Node<PipelineNodeData>,
    TypedEdgeType
  > | null>(null);

  const modalsRef = useRef<PipelineModalsHandle>(null);
  const autoOpenedWizard = useRef(false);

  const {
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
  } = useNodeEditing({ nodes, setNodes, setEdges });

  useLiveValidation({
    token,
    nodes,
    edges,
    variables,
    draft: nodeDraft,
    enabled: Boolean(selectedPipeline) && !isPreview,
    onIssues: applyValidationIssues,
  });

  // Every non-hidden node is available in every editor — what a pipeline can
  // do is derived from its graph, so the library never gates by kind (an
  // indexer inside a tool pipeline is a legitimate build).
  const catalogSpecs = useMemo(() => nodeSpecs.filter((spec) => !spec.hidden), [nodeSpecs]);
  const catalogByFamily = useMemo(() => buildNodeCatalog(catalogSpecs), [catalogSpecs]);

  const {
    addNode: handleAddNode,
    previewNode: handlePreviewNode,
    dragDrop,
  } = useNodeInsertion({
    catalogSpecs,
    reactFlowInstance,
    llmModels: modelCatalogs.llmModels,
    hasRerankingProvider,
    rerankingProviderMessage,
    addNode,
    previewNodeSpec,
    setMessage,
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

  useCanvasSeeding({
    selectedPipeline,
    nodeSpecs,
    setNodes,
    setEdges,
    setVariables,
    closeEditor,
    clearDropPreview: dragDrop.handleDragLeave,
  });

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

  // The palette answers the names on the canvas: a default graph calls its
  // retriever "Semantic Retriever" while the catalog entry is "Retriever", and
  // searching what you can read is otherwise reported as no match.
  const nodeInstanceLabels = useMemo(
    () => instanceLabelsByType(nodes.map((node) => node.data)),
    [nodes],
  );

  const handleSelectPipeline = (pipeline: typeof selectedPipeline) => {
    if (pipeline?.id === selectedPipeline?.id) return;
    guard(() => setSelectedPipeline(pipeline));
  };

  const openPipelineNode = usePipelineDeepLink({
    pipelines,
    nodes,
    seedPipeline: setSelectedPipeline,
    switchPipeline: handleSelectPipeline,
    openNode,
  });
  const editorHandle = useMemo(() => ({ openNode: openPipelineNode }), [openPipelineNode]);

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
    selectedPipeline,
    nodes,
    edges,
    setNodes,
    reactFlowInstance,
    persistLayout,
  });

  const handleOpenIndexRegistry = (returnToWizard?: boolean) =>
    modalsRef.current?.openIndexRegistry(returnToWizard);

  // What would fail this save, gathered from both validators: the synchronous
  // client checks and the debounced server pass. The dialog opens on these
  // rather than the button refusing silently — the graph rules that reject a
  // save (cycles, unreachable nodes) live on the server, so a check that reads
  // only the client errors lets an invalid definition through to a save that
  // then fails, and one that reads neither leaves the user nothing to act on.
  const saveBlockers = useMemo(
    () => collectSaveBlockers({ nodes, nodeErrors, issues: validationIssues }),
    [nodes, nodeErrors, validationIssues],
  );

  const handleOpenSave = () => {
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

  const inspectedNodeErrors = inspectedCanvasNode ? (nodeErrors[inspectedCanvasNode.id] ?? []) : [];
  const inspectedValidationIssues = inspectedCanvasNode
    ? validationIssues.filter((issue) => issue.node_id === inspectedCanvasNode.id)
    : [];

  const expectedDimension = useExpectedEmbeddingDimension({
    inspectedNode,
    nodes,
    edges,
    modelCatalogs,
  });

  // Declaring an index variable from a node's field: it holds the index that
  // node already named, so the graph still says exactly where data lands.
  const handleDeclareIndexVariable = useCallback((declaration: IndexVariableDeclaration) => {
    setVariables((previous) =>
      previous.some((variable) => variable.name === declaration.name)
        ? previous
        : [...previous, buildIndexVariable(declaration)],
    );
  }, []);

  return (
    <PipelineEditorContext.Provider value={editorHandle}>
      <PipelineModals
        ref={modalsRef}
        kind={kind}
        token={token ?? ""}
        indexes={indexes}
        backends={backends}
        nodeSpecs={nodeSpecs}
        embeddingModels={modelCatalogs.embeddingModels}
        embeddingCatalog={modelCatalogs.embeddingCatalog}
        embeddingModelsLoading={modelCatalogs.embeddingModelsLoading}
        embeddingModelsError={modelCatalogs.embeddingModelsError}
        reranking={wizardRerankingCatalog}
        onCatalogVisible={modelCatalogs.onEmbeddingCatalogVisible}
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
        onOpenIndexRegistry={() => handleOpenIndexRegistry()}
        unsavedCount={pendingMaterialChanges.length}
        onOpenSave={handleOpenSave}
        onOpenHistory={() => setHistoryOpen(true)}
        hasPipeline={Boolean(selectedPipeline)}
        pipelineName={selectedPipeline?.name}
        pipelineVersion={selectedPipeline?.current_version}
        onRenamePipeline={() => setRenameOpen(true)}
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
          onCopyPipeline: handleCopyPipeline,
          pipelineUsage,
          onPreviewNode: handlePreviewNode,
          onBrowseAllNodes: () => setNodeCatalogOpen(true),
          nodeInstanceLabels,
          variables,
          onVariablesChange: setVariables,
          variableNodes,
          modelOptions: modelCatalogs.embeddingModels,
          indexOptions: registeredIndexes,
          variablesDisabled: !selectedPipeline,
          hasRerankingProvider,
          rerankingProviderMessage,
          knownBackends: backends.map((info) => info.backend),
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
          onNodeOpen: openNode,
          onNodeDelete: deleteNode,
          onNodesDelete: handleNodesDeleted,
          onNodeDragStop: scheduleLayoutSave,
          onAutoLayout: handleAutoLayout,
          onDrop: dragDrop.handleDrop,
          onDragOver: dragDrop.handleDragOver,
          onDragLeave: dragDrop.handleDragLeave,
          onInit: setReactFlowInstance,
        }}
      />

      {nodeCatalogOpen ? (
        <NodeCatalogOverlay
          catalog={catalogByFamily}
          onClose={() => setNodeCatalogOpen(false)}
          onAddNode={(spec) => {
            handleAddNode(spec);
            setNodeCatalogOpen(false);
          }}
          hasRerankingProvider={hasRerankingProvider}
          rerankingProviderMessage={rerankingProviderMessage}
          knownBackends={backends.map((info) => info.backend)}
        />
      ) : null}

      <NodeEditorDrawer
        node={inspectedNode}
        onClose={closeEditor}
        onApply={applyNodeEdits}
        onDraftChange={(nodeId, config) => setNodeDraft({ nodeId, config })}
        isPreview={isPreview}
        onAddToCanvas={previewSpec ? () => handleAddNode(previewSpec) : undefined}
        validationErrors={inspectedNodeErrors}
        validationIssues={inspectedValidationIssues}
        variables={variables}
        onDeclareIndexVariable={handleDeclareIndexVariable}
        vectorIndexes={indexes}
        expectedDimension={expectedDimension}
        onOpenIndexRegistry={handleOpenIndexRegistry}
        {...modelCatalogs}
        onCatalogVisible={modelCatalogs.onEmbeddingCatalogVisible}
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
        saveBlockers={saveBlockers}
        historyOpen={historyOpen}
        onCloseHistory={() => setHistoryOpen(false)}
        versions={versions}
        currentVersion={selectedPipeline?.current_version}
        activating={saving}
        onActivate={handleActivateVersion}
        discardOpen={confirmOpen}
        onConfirmDiscard={confirmDiscard}
        onCancelDiscard={cancelDiscard}
        renameOpen={renameOpen}
        onCloseRename={() => setRenameOpen(false)}
        renamePipeline={selectedPipeline}
        onRename={handleRenamePipeline}
      />
      <TokenizerConsentDialog
        modelId={tokenizerConsent.modelId}
        remember={tokenizerConsent.remember}
        loading={tokenizerConsent.loading}
        onRememberChange={tokenizerConsent.setRemember}
        onConfirm={() => void tokenizerConsent.confirm()}
        onCancel={tokenizerConsent.cancel}
      />
    </PipelineEditorContext.Provider>
  );
}
