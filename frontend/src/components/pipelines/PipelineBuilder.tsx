"use client";

import { addEdge, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import {
  activatePipelineVersion,
  createPipeline,
  deletePipeline,
  fetchCollections,
  fetchPipelineNodes,
  fetchPipelines,
  listPipelineVersions,
  updatePipeline,
  validatePipeline,
} from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

import { resolveNodeDescription, resolveNodeExample } from "./node-content";
import { validatePipelineConnection } from "./pipeline-io";
import { PIPELINE_KIND_STORAGE_KEY } from "./pipeline-kinds";
import {
  buildDefaultDefinition,
  buildNodeCatalog,
  createDefaultNodePosition,
  createId,
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
import type { Collection, NodeSpec, Pipeline, PipelineKind, PipelineVersion } from "@/lib/types";
import type { Connection, Edge, Node } from "@xyflow/react";

type PipelineBuilderProps = {
  kind: PipelineKind;
};

const HIDDEN_NODE_TYPES = new Set(["chunker.collection"]);

export function PipelineBuilder({ kind }: PipelineBuilderProps) {
  const { token } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [nodeSpecs, setNodeSpecs] = useState<NodeSpec[]>([]);
  const [versions, setVersions] = useState<PipelineVersion[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>({});
  const [changeSummary, setChangeSummary] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

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
  }, [selectedPipeline, nodeSpecs, setNodes, setEdges]);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipeline) {
      setVersions([]);
      return;
    }
    let cancelled = false;

    async function loadVersions() {
      try {
        const data = await listPipelineVersions(selectedPipeline.id, authToken);
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
    if (!selectedNode) {
      setConfigDraft({});
      return;
    }
    setConfigDraft({ ...(selectedNode.data.config ?? {}) });
  }, [selectedNode]);

  const validateConnection = (connection: Connection) =>
    validatePipelineConnection(connection, nodes);

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

  const handleAddNode = (spec: NodeSpec) => {
    const nodeId = createId();
    const description = resolveNodeDescription(spec);
    const example = resolveNodeExample(spec);
    const newNode: Node<PipelineNodeData> = {
      id: nodeId,
      type: "pipelineNode",
      position: createDefaultNodePosition(nodes.length),
      data: {
        label: spec.label,
        nodeType: spec.type,
        description,
        example,
        inputs: spec.input_ports,
        outputs: spec.output_ports,
        config: spec.default_config ?? {},
        configSchema: spec.config_schema ?? {},
      },
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(nodeId);
  };

  const handleApplyConfig = () => {
    if (!selectedNode) return;
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
    setValidating(true);
    setMessage(null);
    try {
      const definition = toPipelineDefinition(nodes, edges);
      const validation = await validatePipeline(authToken, definition);
      if (!validation.valid) {
        setMessage(`Validation failed: ${validation.errors.join(" ")}`);
        return;
      }
      setSaving(true);
      const updated = await updatePipeline(selectedPipeline.id, authToken, {
        definition,
        change_summary: changeSummary || "Updated pipeline definition.",
      });
      setPipelines((prev) =>
        prev.map((pipeline) => (pipeline.id === updated.id ? updated : pipeline)),
      );
      setSelectedPipeline(updated);
      setChangeSummary("");
      setMessage("Pipeline saved as a new version.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save pipeline.");
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  const handleCreatePipeline = async () => {
    const authToken = token ?? "";
    if (!authToken) return;
    setSaving(true);
    setMessage(null);
    try {
      const definition = buildDefaultDefinition(kind);
      const created = await createPipeline(authToken, {
        name: `New ${kind === "ingestion" ? "Ingestion" : "Retrieval"} Pipeline`,
        kind,
        definition,
        change_summary: "Initial pipeline scaffold.",
      });
      setPipelines((prev) => [created, ...prev]);
      setSelectedPipeline(created);
      setChangeSummary("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create pipeline.");
    } finally {
      setSaving(false);
    }
  };

  const handleActivateVersion = async (version: PipelineVersion) => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipeline) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await activatePipelineVersion(
        selectedPipeline.id,
        version.version,
        authToken,
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
      setMessage("This pipeline is used by a collection and cannot be deleted.");
      setDeleteTarget(null);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await deletePipeline(deleteTarget.id, authToken);
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

  const catalogSpecs = useMemo(
    () => nodeSpecs.filter((spec) => spec.category === kind && !HIDDEN_NODE_TYPES.has(spec.type)),
    [nodeSpecs, kind],
  );
  const catalogByFamily = useMemo(() => buildNodeCatalog(catalogSpecs), [catalogSpecs]);

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
      <PipelineHeader kind={kind} onCreatePipeline={handleCreatePipeline} />

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
              onAddNode={handleAddNode}
            />
          </div>

          <PipelineCanvas
            nodes={nodes}
            edges={edges}
            selectedPipeline={selectedPipeline}
            notice={message}
            onNoticeDismiss={() => setMessage(null)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            isValidConnection={(connection) => validateConnection(connection).valid}
            onNodeSelect={setSelectedNodeId}
          />

          <div className="flex min-h-0 flex-col gap-6 xl:overflow-y-auto">
            <PipelineInspector
              selectedNode={selectedNode}
              configDraft={configDraft}
              onConfigDraftChange={setConfigDraft}
              onLabelChange={handleLabelChange}
              onApplyConfig={handleApplyConfig}
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
