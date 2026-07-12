import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { FlowStep } from "@/components/pipelines/flow/use-flow-playback";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodePort } from "@/lib/types";
import type { Node } from "@xyflow/react";

/**
 * The landing-page hero backdrop shows a *synthetic* end-to-end RAG pipeline —
 * a document flowing from ingestion through retrieval to chat. It is built
 * entirely in memory, with no telemetry, no real traces, and no network calls,
 * so it can render on the unauthenticated public page. The visualization
 * itself is the real product component (`FlowPlayer`), fed hand-authored
 * nodes/edges/steps in the same shape the trace viewer produces.
 */

type DemoPort = { key: string; label: string; dataType: string };

type DemoNode = {
  id: string;
  /** Prefix (before the dot) drives the node's color family in PipelineNode. */
  nodeType: string;
  label: string;
  description: string;
  input?: DemoPort;
  output?: DemoPort;
};

/**
 * Document → Parse → Chunk → Embed → Index → Retrieve → Chat. Each hop's wire
 * is colored by the upstream node's output data type, matching the port-color
 * language used throughout the pipeline editor and trace viewer.
 */
const DEMO_NODES: DemoNode[] = [
  {
    id: "source",
    nodeType: "ingestion.source",
    label: "Document",
    description: "A source file enters the pipeline.",
    output: { key: "file", label: "Source file", dataType: "document_source" },
  },
  {
    id: "parse",
    nodeType: "parser.pdf",
    label: "Parse",
    description: "Extract clean text from the raw file.",
    input: { key: "file", label: "Source file", dataType: "document_source" },
    output: { key: "document", label: "Parsed document", dataType: "document" },
  },
  {
    id: "chunk",
    nodeType: "chunker.recursive",
    label: "Chunk",
    description: "Split text into overlapping passages.",
    input: { key: "document", label: "Parsed document", dataType: "document" },
    output: { key: "chunks", label: "Chunks", dataType: "chunk_batch" },
  },
  {
    id: "embed",
    nodeType: "embedder.openrouter",
    label: "Embed",
    description: "Turn each chunk into a vector.",
    input: { key: "chunks", label: "Chunks", dataType: "chunk_batch" },
    output: { key: "embedded", label: "Embedded chunks", dataType: "embedded_batch" },
  },
  {
    id: "index",
    nodeType: "indexer.vector",
    label: "Index",
    description: "Store vectors in the collection.",
    input: { key: "embedded", label: "Embedded chunks", dataType: "embedded_batch" },
    output: { key: "indexed", label: "Indexed chunks", dataType: "indexed_batch" },
  },
  {
    id: "retrieve",
    nodeType: "retriever.vector",
    label: "Retrieve",
    description: "Find the passages that matter.",
    input: { key: "indexed", label: "Indexed chunks", dataType: "indexed_batch" },
    output: { key: "results", label: "Results", dataType: "retrieval_results" },
  },
  {
    id: "chat",
    nodeType: "chat.completion",
    label: "Chat",
    description: "Answer, grounded in the evidence.",
    input: { key: "results", label: "Results", dataType: "retrieval_results" },
  },
];

/** Matches the pipeline editor's scaffold spacing so the graph reads familiarly. */
const NODE_SPACING_X = 368;

const toPort = (port: DemoPort): NodePort => ({
  key: port.key,
  label: port.label,
  data_type: port.dataType,
  required: true,
  accepts_many: false,
});

export type DemoFlow = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  steps: FlowStep[];
};

/** Build the synthetic hero pipeline graph. Pure — safe to memoize once. */
export function buildDemoFlow(): DemoFlow {
  const nodes: Node<PipelineNodeData>[] = DEMO_NODES.map((node, index) => ({
    id: node.id,
    type: "pipelineNode",
    position: { x: NODE_SPACING_X * index, y: 0 },
    data: {
      label: node.label,
      nodeType: node.nodeType,
      description: node.description,
      inputs: node.input ? [toPort(node.input)] : [],
      outputs: node.output ? [toPort(node.output)] : [],
      config: {},
    },
  }));

  const edges: TypedEdgeType[] = [];
  for (let i = 0; i < DEMO_NODES.length - 1; i += 1) {
    const source = DEMO_NODES[i];
    const target = DEMO_NODES[i + 1];
    // Only chain nodes that actually expose the connecting ports.
    if (!source.output || !target.input) continue;
    edges.push({
      id: `${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      sourceHandle: source.output.key,
      targetHandle: target.input.key,
      type: "typed",
      // Wire color comes from the upstream output port, as toFlowEdges does.
      data: { dataType: source.output.dataType },
    });
  }

  const steps: FlowStep[] = DEMO_NODES.map((node) => ({ nodeId: node.id }));

  return { nodes, edges, steps };
}
