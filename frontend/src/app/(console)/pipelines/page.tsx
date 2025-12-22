"use client";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Braces, ClipboardCheck, Layers, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import {
  activatePipelineVersion,
  createPipeline,
  fetchPipelineNodes,
  fetchPipelines,
  listPipelineVersions,
  updatePipeline,
  validatePipeline,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import type {
  NodeSpec,
  Pipeline,
  PipelineDefinition,
  PipelineKind,
  PipelineVersion,
} from "@/lib/types";
import type { Connection, Edge, Node, NodeProps } from "@xyflow/react";

type PipelineNodeData = {
  label: string;
  nodeType: string;
  description?: string;
  inputs: NodeSpec["input_ports"];
  outputs: NodeSpec["output_ports"];
  config: Record<string, unknown>;
};

const nodeTypes = {
  pipelineNode: ({ data }: NodeProps<PipelineNodeData>) => (
    <div className="relative min-w-[180px] rounded-2xl border border-white/10 bg-slate-900/90 px-3 py-3 text-xs text-slate-200 shadow-lg">
      {data.inputs.map((port, index) => (
        <Handle
          key={`input-${port.key}`}
          type="target"
          position={Position.Top}
          id={port.key}
          className="h-2 w-2 rounded-full border border-slate-500 bg-slate-900"
          style={{ left: `${((index + 1) / (data.inputs.length + 1)) * 100}%` }}
        />
      ))}
      {data.outputs.map((port, index) => (
        <Handle
          key={`output-${port.key}`}
          type="source"
          position={Position.Bottom}
          id={port.key}
          className="h-2 w-2 rounded-full border border-slate-500 bg-slate-900"
          style={{ left: `${((index + 1) / (data.outputs.length + 1)) * 100}%` }}
        />
      ))}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white">{data.label}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400">
          {data.nodeType}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {data.inputs.map((port) => (
          <div key={port.key} className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">{port.label}</span>
            <span className="text-slate-400">{port.data_type}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 space-y-1">
        {data.outputs.map((port) => (
          <div key={port.key} className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">{port.label}</span>
            <span className="text-slate-400">{port.data_type}</span>
          </div>
        ))}
      </div>
    </div>
  ),
};

const createId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const PORT_SOURCE = "source";
const PORT_DOCUMENT = "document";
const PORT_CHUNKS = "chunks";
const PORT_EMBEDDED = "embedded";
const PORT_INDEXED = "indexed";
const PORT_REQUEST = "request";
const PORT_RESULTS = "results";
const NODE_QUERY_INPUT = "query-input";
const NODE_PINECONE_RETRIEVER = "pinecone-retriever";
const NODE_RETRIEVAL_OUTPUT = "retrieval-output";
const NODE_INGEST_INPUT = "ingest-input";
const NODE_PARSE_DOCUMENT = "parse-document";
const NODE_CHUNK_DOCUMENT = "chunk-document";
const NODE_EMBED_CHUNKS = "embed-chunks";
const NODE_INDEX_CHUNKS = "index-chunks";
const NODE_INGEST_OUTPUT = "ingest-output";

const buildDefaultDefinition = (kind: PipelineKind): PipelineDefinition => {
  if (kind === "retrieval") {
    return {
      nodes: [
        {
          id: NODE_QUERY_INPUT,
          type: "retrieval.input",
          name: "Retrieval Input",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: NODE_PINECONE_RETRIEVER,
          type: "retriever.pinecone",
          name: "Pinecone Retriever",
          config: {},
          position: { x: 0, y: 140 },
        },
        {
          id: NODE_RETRIEVAL_OUTPUT,
          type: "retrieval.output",
          name: "Retrieval Output",
          config: {},
          position: { x: 0, y: 280 },
        },
      ],
      edges: [
        {
          id: "edge-retrieval-input",
          source: NODE_QUERY_INPUT,
          target: NODE_PINECONE_RETRIEVER,
          source_port: PORT_REQUEST,
          target_port: PORT_REQUEST,
        },
        {
          id: "edge-retrieval-output",
          source: NODE_PINECONE_RETRIEVER,
          target: NODE_RETRIEVAL_OUTPUT,
          source_port: PORT_RESULTS,
          target_port: PORT_RESULTS,
        },
      ],
      viewport: {},
    };
  }

  return {
    nodes: [
      {
        id: NODE_INGEST_INPUT,
        type: "ingestion.input",
        name: "Ingestion Input",
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: NODE_PARSE_DOCUMENT,
        type: "parser.document",
        name: "Document Parser",
        config: {},
        position: { x: 0, y: 140 },
      },
      {
        id: NODE_CHUNK_DOCUMENT,
        type: "chunker.collection",
        name: "Chunker",
        config: {},
        position: { x: 0, y: 280 },
      },
      {
        id: NODE_EMBED_CHUNKS,
        type: "embedder.openrouter",
        name: "Embedder",
        config: {},
        position: { x: 0, y: 420 },
      },
      {
        id: NODE_INDEX_CHUNKS,
        type: "indexer.pinecone",
        name: "Indexer",
        config: {},
        position: { x: 0, y: 560 },
      },
      {
        id: NODE_INGEST_OUTPUT,
        type: "ingestion.output",
        name: "Ingestion Output",
        config: {},
        position: { x: 0, y: 700 },
      },
    ],
    edges: [
      {
        id: "edge-ingest-input-parser",
        source: NODE_INGEST_INPUT,
        target: NODE_PARSE_DOCUMENT,
        source_port: PORT_SOURCE,
        target_port: PORT_SOURCE,
      },
      {
        id: "edge-parser-chunker",
        source: NODE_PARSE_DOCUMENT,
        target: NODE_CHUNK_DOCUMENT,
        source_port: PORT_DOCUMENT,
        target_port: PORT_DOCUMENT,
      },
      {
        id: "edge-chunker-embedder",
        source: NODE_CHUNK_DOCUMENT,
        target: NODE_EMBED_CHUNKS,
        source_port: PORT_CHUNKS,
        target_port: PORT_CHUNKS,
      },
      {
        id: "edge-embedder-indexer",
        source: NODE_EMBED_CHUNKS,
        target: NODE_INDEX_CHUNKS,
        source_port: PORT_EMBEDDED,
        target_port: PORT_EMBEDDED,
      },
      {
        id: "edge-indexer-output",
        source: NODE_INDEX_CHUNKS,
        target: NODE_INGEST_OUTPUT,
        source_port: PORT_INDEXED,
        target_port: PORT_INDEXED,
      },
    ],
    viewport: {},
  };
};

const toFlowNodes = (definition: PipelineDefinition, specs: NodeSpec[]): Node<PipelineNodeData>[] =>
  definition.nodes.map((node) => {
    const spec = specs.find((item) => item.type === node.type);
    return {
      id: node.id,
      type: "pipelineNode",
      position: node.position ?? { x: 0, y: 0 },
      data: {
        label: node.name,
        nodeType: node.type,
        description: spec?.description,
        inputs: spec?.input_ports ?? [],
        outputs: spec?.output_ports ?? [],
        config: node.config ?? {},
      },
    };
  });

const toFlowEdges = (definition: PipelineDefinition): Edge[] =>
  definition.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.source_port ?? undefined,
    targetHandle: edge.target_port ?? undefined,
    type: "smoothstep",
  }));

const toPipelineDefinition = (
  nodes: Node<PipelineNodeData>[],
  edges: Edge[],
): PipelineDefinition => ({
  nodes: nodes.map((node) => ({
    id: node.id,
    type: node.data.nodeType,
    name: node.data.label,
    config: node.data.config,
    position: node.position,
  })),
  edges: edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    source_port: edge.sourceHandle ?? undefined,
    target_port: edge.targetHandle ?? undefined,
  })),
  viewport: {},
});

export default function PipelinesPage() {
  const { token } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [nodeSpecs, setNodeSpecs] = useState<NodeSpec[]>([]);
  const [versions, setVersions] = useState<PipelineVersion[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);

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
        const [pipelinesResponse, nodesResponse] = await Promise.all([
          fetchPipelines(authToken),
          fetchPipelineNodes(authToken),
        ]);
        if (cancelled) return;
        setPipelines(pipelinesResponse);
        setNodeSpecs(nodesResponse);
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
  }, [token]);

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
      setConfigDraft("");
      return;
    }
    setConfigDraft(JSON.stringify(selectedNode.data.config ?? {}, null, 2));
  }, [selectedNode]);

  const handleConnect = (connection: Connection) => {
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
    const newNode: Node<PipelineNodeData> = {
      id: nodeId,
      type: "pipelineNode",
      position: { x: 160, y: 140 + nodes.length * 140 },
      data: {
        label: spec.label,
        nodeType: spec.type,
        description: spec.description,
        inputs: spec.input_ports,
        outputs: spec.output_ports,
        config: spec.default_config ?? {},
      },
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(nodeId);
  };

  const handleApplyConfig = () => {
    if (!selectedNode) return;
    try {
      const parsed = JSON.parse(configDraft || "{}");
      setNodes((prev) =>
        prev.map((node) =>
          node.id === selectedNode.id ? { ...node, data: { ...node.data, config: parsed } } : node,
        ),
      );
      setMessage("Node configuration updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid JSON configuration.");
    }
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

  const handleCreatePipeline = async (kind: PipelineKind) => {
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

  const catalogByCategory = useMemo(() => {
    return nodeSpecs.reduce<Record<string, NodeSpec[]>>((acc, spec) => {
      acc[spec.category] = acc[spec.category] ?? [];
      acc[spec.category].push(spec);
      return acc;
    }, {});
  }, [nodeSpecs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Pipelines</p>
          <h1 className="text-3xl font-semibold text-white">Design ingestion & retrieval flows.</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => handleCreatePipeline("ingestion")}>
            <Plus className="h-4 w-4" />
            New ingestion pipeline
          </Button>
          <Button onClick={() => handleCreatePipeline("retrieval")}>
            <Plus className="h-4 w-4" />
            New retrieval pipeline
          </Button>
        </div>
      </div>

      {message && (
        <GlassCard className="rounded-3xl border border-white/10 p-4 text-sm text-slate-200">
          {message}
        </GlassCard>
      )}

      {loading ? (
        <GlassCard className="flex items-center justify-center rounded-3xl p-10">
          <Loader className="h-6 w-6" />
        </GlassCard>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[280px_1fr_320px]">
          <GlassCard className="rounded-3xl p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Layers className="h-4 w-4 text-violet-300" />
              Pipeline catalog
            </div>
            <div className="mt-4 space-y-3">
              {pipelines.length === 0 && (
                <p className="text-sm text-slate-400">No pipelines yet. Create one above.</p>
              )}
              {pipelines.map((pipeline) => (
                <button
                  key={pipeline.id}
                  type="button"
                  onClick={() => setSelectedPipeline(pipeline)}
                  className={cn(
                    "w-full rounded-2xl border px-3 py-3 text-left text-sm transition",
                    selectedPipeline?.id === pipeline.id
                      ? "border-violet-400 bg-violet-500/10 text-white"
                      : "border-white/5 bg-white/5 text-slate-300 hover:border-white/20",
                  )}
                >
                  <p className="font-semibold">{pipeline.name}</p>
                  <p className="text-xs text-slate-400">
                    {pipeline.kind} • v{pipeline.current_version}
                  </p>
                </button>
              ))}
            </div>

            <div className="mt-6 border-t border-white/5 pt-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Node library</p>
              <div className="mt-3 space-y-4">
                {Object.entries(catalogByCategory).map(([category, specs]) => (
                  <div key={category}>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{category}</p>
                    <div className="mt-2 space-y-2">
                      {specs.map((spec) => (
                        <button
                          key={spec.type}
                          type="button"
                          onClick={() => handleAddNode(spec)}
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-slate-200 hover:border-violet-400"
                        >
                          <p className="font-semibold">{spec.label}</p>
                          <p className="text-[10px] text-slate-500">{spec.type}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>

          <GlassCard className="relative min-h-[520px] overflow-hidden rounded-3xl border border-white/5 bg-slate-950/80">
            <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-xs text-slate-300">
              <ClipboardCheck className="h-4 w-4 text-cyan-300" />
              {selectedPipeline ? (
                <span>
                  Editing {selectedPipeline.name} • v{selectedPipeline.current_version}
                </span>
              ) : (
                <span>Select a pipeline to edit.</span>
              )}
            </div>
            <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-xs text-slate-300">
              <Braces className="h-4 w-4 text-violet-300" />
              <span>
                {nodes.length} nodes • {edges.length} edges
              </span>
            </div>
            <div className="h-full min-h-[520px]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={handleConnect}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                nodeTypes={nodeTypes}
                fitView
              >
                <Background gap={18} size={1} color="#1f2937" />
                <Controls />
              </ReactFlow>
            </div>
          </GlassCard>

          <div className="space-y-6">
            <GlassCard className="rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Inspector</p>
              {selectedNode ? (
                <div className="mt-4 space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-400">Node label</p>
                    <input
                      className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
                      value={selectedNode.data.label}
                      onChange={(event) =>
                        setNodes((prev) =>
                          prev.map((node) =>
                            node.id === selectedNode.id
                              ? {
                                  ...node,
                                  data: { ...node.data, label: event.target.value },
                                }
                              : node,
                          ),
                        )
                      }
                    />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Node type</p>
                    <p className="text-sm text-white">{selectedNode.data.nodeType}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Config</p>
                    <textarea
                      className="mt-1 h-40 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-violet-400"
                      value={configDraft}
                      onChange={(event) => setConfigDraft(event.target.value)}
                    />
                  </div>
                  <Button variant="secondary" onClick={handleApplyConfig}>
                    Apply config
                  </Button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">
                  Select a node to inspect or tweak configuration.
                </p>
              )}
            </GlassCard>

            <GlassCard className="rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Save version</p>
              <div className="mt-3 space-y-3">
                <input
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
                  placeholder="Change summary"
                  value={changeSummary}
                  onChange={(event) => setChangeSummary(event.target.value)}
                />
                <Button onClick={handleSavePipeline} loading={saving || validating}>
                  Save pipeline
                </Button>
              </div>
            </GlassCard>

            <GlassCard className="rounded-3xl p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Revisions</p>
              <div className="mt-3 space-y-3 text-sm">
                {versions.length === 0 && (
                  <p className="text-sm text-slate-400">No revisions loaded.</p>
                )}
                {versions.map((version) => {
                  const isCurrent = selectedPipeline?.current_version === version.version;
                  return (
                    <div
                      key={version.id}
                      className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-white">v{version.version}</p>
                          <p className="text-xs text-slate-400">
                            {version.change_summary || "No summary provided."}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={isCurrent ? "secondary" : "ghost"}
                          disabled={isCurrent || saving}
                          onClick={() => handleActivateVersion(version)}
                        >
                          {isCurrent ? "Active" : "Activate"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </div>
        </div>
      )}
    </div>
  );
}
