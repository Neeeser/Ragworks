"use client";

import { addEdge, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState, type DragEvent } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import {
  activatePipelineVersion,
  deletePipeline,
  fetchCollections,
  fetchPipelineNodes,
  fetchPipelines,
  fetchEmbeddingModels,
  listPineconeIndexes,
  listPipelineVersions,
  updatePipeline,
  validatePipeline,
} from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

import { CreatePipelineWizard } from "./CreatePipelineWizard";
import { IndexManagerModal } from "./index-manager/IndexManagerModal";
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
  toPipelineDefinition,
} from "./pipeline-utils";
import { PipelineCanvas } from "./PipelineCanvas";
import { PipelineHeader } from "./PipelineHeader";
import { PipelineInspector } from "./PipelineInspector";
import { PipelineRevisions } from "./PipelineRevisions";
import { PipelineSavePanel } from "./PipelineSavePanel";
import { PipelineSidebar } from "./PipelineSidebar";

import type { PipelineNodeData } from "./PipelineNode";
import type {
  Collection,
  EmbeddingModelInfo,
  NodeSpec,
  Pipeline,
  PipelineKind,
  PipelineVersion,
  PineconeIndex,
} from "@/lib/types";
import type { Connection, Edge, Node, ReactFlowInstance } from "@xyflow/react";

type PipelineBuilderProps = {
  kind: PipelineKind;
};

const HIDDEN_NODE_TYPES = new Set(["chunker.collection"]);
const PREVIEW_NODE_SIZE = { width: 180, height: 72 };

type LegacyReactFlowInstance = {
  project: (point: { x: number; y: number }) => { x: number; y: number };
};

// @xyflow/react v12 instances always expose screenToFlowPosition, but some callers
// (and tests) still provide the pre-v12 `.project` API; support both. A `typeof`
// check is used instead of `"x" in instance` narrowing because the v12 type makes
// screenToFlowPosition non-optional, which would make the fallback branch
// statically unreachable (and thus untypeable) under `in`-based narrowing.
const resolveFlowPosition = (
  instance: ReactFlowInstance<Node<PipelineNodeData>, Edge>,
  point: { x: number; y: number },
) =>
  typeof instance.screenToFlowPosition === "function"
    ? instance.screenToFlowPosition(point)
    : (instance as unknown as LegacyReactFlowInstance).project(point);

export function PipelineBuilder({ kind }: PipelineBuilderProps) {
  const { token } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [nodeSpecs, setNodeSpecs] = useState<NodeSpec[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelInfo[]>([]);
  const [embeddingModelsLoading, setEmbeddingModelsLoading] = useState(false);
  const [embeddingModelsError, setEmbeddingModelsError] = useState<string | null>(null);
  const [indexes, setIndexes] = useState<PineconeIndex[]>([]);
  const [indexesLoading, setIndexesLoading] = useState(false);
  const [indexesError, setIndexesError] = useState<string | null>(null);
  const [versions, setVersions] = useState<PipelineVersion[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PipelineNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewSpec, setPreviewSpec] = useState<NodeSpec | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    Node<PipelineNodeData>,
    Edge
  > | null>(null);
  const [dropPreviewPosition, setDropPreviewPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dropPreviewLabel, setDropPreviewLabel] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>({});
  const [changeSummary, setChangeSummary] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);
  const [showIndexManager, setShowIndexManager] = useState(false);
  const [showCreatePipeline, setShowCreatePipeline] = useState(false);
  const [returnToPipelineWizard, setReturnToPipelineWizard] = useState(false);

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
  const nodesWithPreview = useMemo(() => {
    if (!dropPreviewPosition) return nodes;
    const dropPreviewNode = {
      id: "drop-preview",
      type: "dropPreview",
      position: dropPreviewPosition,
      data: { label: dropPreviewLabel ?? "Drop here" },
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    } satisfies Node;
    // The drop-preview node carries DropPreviewNodeData, not PipelineNodeData; xyflow
    // dispatches rendering by `type`, so the heterogeneous array is safe at runtime even
    // though it can't be expressed without a discriminated Node union across this module.
    return [...nodes, dropPreviewNode as unknown as Node<PipelineNodeData>];
  }, [dropPreviewLabel, dropPreviewPosition, nodes]);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [pipelinesResponse, nodesResponse, collectionsResponse] = await Promise.all([
          fetchPipelines(authToken, kind),
          fetchPipelineNodes(authToken),
          fetchCollections(authToken),
        ]);
        if (cancelled) return;
        setPipelines(pipelinesResponse);
        setNodeSpecs(nodesResponse);
        setCollections(collectionsResponse);
        setSelectedPipeline(pipelinesResponse[0] ?? null);
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Unable to load pipelines.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token, kind]);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;
    async function loadEmbeddingModels() {
      setEmbeddingModelsLoading(true);
      setEmbeddingModelsError(null);
      try {
        const models = await fetchEmbeddingModels(authToken);
        if (!cancelled) {
          setEmbeddingModels(models);
        }
      } catch (error) {
        if (!cancelled) {
          setEmbeddingModelsError(
            error instanceof Error ? error.message : "Unable to load embedding models.",
          );
        }
      } finally {
        if (!cancelled) setEmbeddingModelsLoading(false);
      }
    }
    loadEmbeddingModels();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const refreshIndexes = async (authToken: string) => {
    setIndexesLoading(true);
    setIndexesError(null);
    try {
      const data = await listPineconeIndexes(authToken);
      setIndexes(data);
    } catch (error) {
      setIndexesError(error instanceof Error ? error.message : "Unable to load indexes.");
    } finally {
      setIndexesLoading(false);
    }
  };

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;
    async function loadIndexes() {
      setIndexesLoading(true);
      setIndexesError(null);
      try {
        const data = await listPineconeIndexes(authToken);
        if (!cancelled) {
          setIndexes(data);
        }
      } catch (error) {
        if (!cancelled) {
          setIndexesError(error instanceof Error ? error.message : "Unable to load indexes.");
        }
      } finally {
        if (!cancelled) setIndexesLoading(false);
      }
    }
    loadIndexes();
    return () => {
      cancelled = true;
    };
  }, [token]);

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
    setDropPreviewPosition(null);
    setDropPreviewLabel(null);
  }, [selectedPipeline, nodeSpecs, setNodes, setEdges]);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipeline) {
      setVersions([]);
      return;
    }
    const pipelineId = selectedPipeline.id;
    let cancelled = false;

    async function loadVersions() {
      try {
        const data = await listPipelineVersions(authToken, pipelineId);
        if (!cancelled) setVersions(data);
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Unable to load versions.");
        }
      }
    }

    loadVersions();
    return () => {
      cancelled = true;
    };
  }, [selectedPipeline, token]);

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
    setDropPreviewPosition(null);
    setDropPreviewLabel(null);
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

  const handleSavePipeline = async () => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipeline) return;
    const validationErrors = Object.values(nodeErrors).flat();
    if (validationErrors.length > 0) {
      setMessage(validationErrors[0]);
      return;
    }
    setValidating(true);
    setMessage(null);
    try {
      const definition = toPipelineDefinition(nodes, edges);
      const validation = await validatePipeline(authToken, definition);
      if (!validation.valid) {
        setMessage(`Validation failed: ${validation.errors.join(" ")}`);
        return;
      }
      const warningText = validation.warnings?.length
        ? `Warnings: ${validation.warnings.join(" ")}`
        : "";
      setSaving(true);
      const updated = await updatePipeline(authToken, selectedPipeline.id, {
        definition,
        change_summary: changeSummary || "Updated pipeline definition.",
      });
      setPipelines((prev) =>
        prev.map((pipeline) => (pipeline.id === updated.id ? updated : pipeline)),
      );
      setSelectedPipeline(updated);
      setChangeSummary("");
      setMessage(
        warningText
          ? `Pipeline saved as a new version. ${warningText}`
          : "Pipeline saved as a new version.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save pipeline.");
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  const handleCreatePipeline = () => {
    setShowCreatePipeline(true);
  };

  const handlePipelineCreated = (created: Pipeline) => {
    setPipelines((prev) => [created, ...prev]);
    setSelectedPipeline(created);
    setChangeSummary("");
  };

  const handleActivateVersion = async (version: PipelineVersion) => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipeline) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await activatePipelineVersion(
        authToken,
        selectedPipeline.id,
        version.version,
      );
      setPipelines((prev) =>
        prev.map((pipeline) => (pipeline.id === updated.id ? updated : pipeline)),
      );
      setSelectedPipeline(updated);
      setMessage(`Activated version ${version.version}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to activate version.");
    } finally {
      setSaving(false);
    }
  };

  const pipelineUsage = useMemo(() => {
    const usage = new Set<string>();
    collections.forEach((collection) => {
      if (collection.ingestion_pipeline_id) {
        usage.add(collection.ingestion_pipeline_id);
      }
      if (collection.retrieval_pipeline_id) {
        usage.add(collection.retrieval_pipeline_id);
      }
    });
    return usage;
  }, [collections]);

  const handleDeletePipeline = async (pipeline: Pipeline) => {
    const authToken = token ?? "";
    if (!authToken) return;
    if (pipelineUsage.has(pipeline.id)) {
      setMessage("This pipeline is used by a collection and cannot be deleted.");
      return;
    }
    setDeleteTarget(pipeline);
  };

  const handleConfirmDelete = async () => {
    const authToken = token ?? "";
    if (!authToken || !deleteTarget) return;
    if (pipelineUsage.has(deleteTarget.id)) {
      /* c8 ignore start -- guarded by pre-check in delete flow */
      setMessage("This pipeline is used by a collection and cannot be deleted.");
      setDeleteTarget(null);
      return;
      /* c8 ignore stop */
    }
    setSaving(true);
    setMessage(null);
    try {
      await deletePipeline(authToken, deleteTarget.id);
      const nextPipelines = pipelines.filter((item) => item.id !== deleteTarget.id);
      setPipelines(nextPipelines);
      if (selectedPipeline?.id === deleteTarget.id) {
        setSelectedPipeline(nextPipelines[0] ?? null);
      }
      setMessage("Pipeline deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete pipeline.");
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  };

  const handleLabelChange = (label: string) => {
    if (!selectedNode) return;
    setNodes((prev) =>
      prev.map((node) =>
        node.id === selectedNode.id ? { ...node, data: { ...node.data, label } } : node,
      ),
    );
  };

  const handleOpenIndexManager = (returnToWizard?: boolean) => {
    setShowIndexManager(true);
    if (returnToWizard) {
      setReturnToPipelineWizard(true);
    }
  };

  const handleRefreshIndexes = () => {
    const authToken = token ?? "";
    if (!authToken) return;
    refreshIndexes(authToken);
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

  const catalogSpecs = useMemo(
    () => nodeSpecs.filter((spec) => spec.category === kind && !HIDDEN_NODE_TYPES.has(spec.type)),
    [nodeSpecs, kind],
  );
  const catalogByFamily = useMemo(() => buildNodeCatalog(catalogSpecs), [catalogSpecs]);

  const handlePreviewNode = (spec: NodeSpec) => {
    setPreviewSpec(spec);
    setSelectedNodeId(null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const type = event.dataTransfer.getData("application/transparentrag-node");
    if (!type) {
      setDropPreviewPosition(null);
      setDropPreviewLabel(null);
      return;
    }
    const spec = catalogSpecs.find((item) => item.type === type);
    if (!spec || !reactFlowInstance) {
      setDropPreviewPosition(null);
      setDropPreviewLabel(null);
      return;
    }
    const point = {
      x: event.clientX - PREVIEW_NODE_SIZE.width / 2,
      y: event.clientY - PREVIEW_NODE_SIZE.height / 2,
    };
    const position = resolveFlowPosition(reactFlowInstance, point);
    setDropPreviewPosition(position);
    setDropPreviewLabel(spec.label);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/transparentrag-node");
    if (!type) return;
    const spec = catalogSpecs.find((item) => item.type === type);
    if (!spec) {
      setMessage("Unable to add node: unknown type.");
      return;
    }
    if (dropPreviewPosition) {
      handleAddNode(spec, dropPreviewPosition);
      return;
    }
    if (!reactFlowInstance) {
      handleAddNode(spec);
      return;
    }
    const point = {
      x: event.clientX - PREVIEW_NODE_SIZE.width / 2,
      y: event.clientY - PREVIEW_NODE_SIZE.height / 2,
    };
    const position = resolveFlowPosition(reactFlowInstance, point);
    handleAddNode(spec, position);
  };

  const handleDragLeave = () => {
    setDropPreviewPosition(null);
    setDropPreviewLabel(null);
  };

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
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete pipeline?"
        description={
          deleteTarget
            ? `This will remove "${deleteTarget.name}" and all of its versions. This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete pipeline"
        confirmVariant="danger"
        loading={saving}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <CreatePipelineWizard
        open={showCreatePipeline}
        token={token ?? ""}
        kind={kind}
        indexes={indexes}
        onClose={() => setShowCreatePipeline(false)}
        onCreated={handlePipelineCreated}
        onOpenIndexManager={() => {
          setShowCreatePipeline(false);
          handleOpenIndexManager(true);
        }}
      />
      <IndexManagerModal
        open={showIndexManager}
        token={token ?? ""}
        indexes={indexes}
        embeddingModels={embeddingModels}
        embeddingModelsLoading={embeddingModelsLoading}
        embeddingModelsError={embeddingModelsError}
        loading={indexesLoading}
        error={indexesError}
        onClose={() => {
          setShowIndexManager(false);
          if (returnToPipelineWizard) {
            setShowCreatePipeline(true);
            setReturnToPipelineWizard(false);
          }
        }}
        onRefresh={handleRefreshIndexes}
      />
      <PipelineHeader
        kind={kind}
        onCreatePipeline={handleCreatePipeline}
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
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
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
              onSave={handleSavePipeline}
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
