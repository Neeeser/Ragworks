import { resolveNodeDescription, resolveNodeExample } from "./node-content";
import { getNodeFamilyOrder, resolveNodeFamily, type NodeFamily } from "./pipeline-theme";

import type { PipelineNodeData } from "./PipelineNode";
import type { NodeSpec, PipelineDefinition, PipelineKind } from "@/lib/types";
import type { Edge, Node } from "@xyflow/react";

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
const DEFAULT_NODE_X = 0;
const DEFAULT_NODE_Y_SPACING = 140;

export const createId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const buildDefaultDefinition = (kind: PipelineKind): PipelineDefinition => {
  if (kind === "retrieval") {
    return {
      nodes: [
        {
          id: NODE_QUERY_INPUT,
          type: "retrieval.input",
          name: "Retrieval Input",
          config: {},
          position: { x: DEFAULT_NODE_X, y: 0 },
        },
        {
          id: NODE_PINECONE_RETRIEVER,
          type: "retriever.pinecone",
          name: "Pinecone Retriever",
          config: {},
          position: { x: DEFAULT_NODE_X, y: DEFAULT_NODE_Y_SPACING },
        },
        {
          id: NODE_RETRIEVAL_OUTPUT,
          type: "retrieval.output",
          name: "Retrieval Output",
          config: {},
          position: { x: DEFAULT_NODE_X, y: DEFAULT_NODE_Y_SPACING * 2 },
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
        position: { x: DEFAULT_NODE_X, y: 0 },
      },
      {
        id: NODE_PARSE_DOCUMENT,
        type: "parser.document",
        name: "Document Parser",
        config: {},
        position: { x: DEFAULT_NODE_X, y: DEFAULT_NODE_Y_SPACING },
      },
      {
        id: NODE_CHUNK_DOCUMENT,
        type: "chunker.token",
        name: "Token Chunker",
        config: {
          chunk_size: 1024,
          chunk_overlap: 200,
        },
        position: { x: DEFAULT_NODE_X, y: DEFAULT_NODE_Y_SPACING * 2 },
      },
      {
        id: NODE_EMBED_CHUNKS,
        type: "embedder.openrouter",
        name: "Embedder",
        config: {},
        position: { x: DEFAULT_NODE_X, y: DEFAULT_NODE_Y_SPACING * 3 },
      },
      {
        id: NODE_INDEX_CHUNKS,
        type: "indexer.pinecone",
        name: "Indexer",
        config: {},
        position: { x: DEFAULT_NODE_X, y: DEFAULT_NODE_Y_SPACING * 4 },
      },
      {
        id: NODE_INGEST_OUTPUT,
        type: "ingestion.output",
        name: "Ingestion Output",
        config: {},
        position: { x: DEFAULT_NODE_X, y: DEFAULT_NODE_Y_SPACING * 5 },
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

export const toFlowNodes = (
  definition: PipelineDefinition,
  specs: NodeSpec[],
): Node<PipelineNodeData>[] =>
  definition.nodes.map((node) => {
    const spec = specs.find((item) => item.type === node.type);
    return {
      id: node.id,
      type: "pipelineNode",
      position: node.position ?? { x: 0, y: 0 },
      data: {
        label: node.name,
        nodeType: node.type,
        description: spec ? resolveNodeDescription(spec) : undefined,
        example: spec ? resolveNodeExample(spec) : undefined,
        inputs: spec?.input_ports ?? [],
        outputs: spec?.output_ports ?? [],
        config: node.config ?? {},
        configSchema: spec?.config_schema ?? {},
      },
    };
  });

export const toFlowEdges = (definition: PipelineDefinition): Edge[] =>
  definition.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.source_port ?? undefined,
    targetHandle: edge.target_port ?? undefined,
    type: "smoothstep",
  }));

export const toPipelineDefinition = (
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

export const buildNodeCatalog = (specs: NodeSpec[]) => {
  const catalog = specs.reduce<Record<NodeFamily, NodeSpec[]>>(
    (acc, spec) => {
      const family = resolveNodeFamily(spec.type);
      acc[family] = acc[family] ?? [];
      acc[family].push(spec);
      return acc;
    },
    {} as Record<NodeFamily, NodeSpec[]>,
  );
  const order = getNodeFamilyOrder();
  return order
    .filter((family) => catalog[family]?.length)
    .map((family) => ({
      family,
      specs: catalog[family] ?? [],
    }));
};

export const createDefaultNodePosition = (count: number) => ({
  x: 160,
  y: 140 + count * 140,
});
