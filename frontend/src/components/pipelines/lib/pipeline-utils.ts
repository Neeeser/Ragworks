import { resolveNodeDescription, resolveNodeExample } from "./node-content";
import { getNodeFamilyOrder, resolveNodeFamily, type NodeFamily } from "./pipeline-theme";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type {
  IndexBackend,
  NodeSpec,
  PipelineDefinition,
  PipelineKind,
  VectorIndex,
} from "@/lib/types";
import type { Node } from "@xyflow/react";

const PORT_SOURCE = "source";
const PORT_DOCUMENT = "document";
const PORT_CHUNKS = "chunks";
const PORT_EMBEDDED = "embedded";
const PORT_QUERY_EMBEDDING = "query_embedding";
const PORT_INDEXED = "indexed";
const PORT_REQUEST = "request";
const PORT_RESULTS = "results";
const NODE_QUERY_INPUT = "query-input";
const NODE_EMBED_QUERY = "embed-query";
const NODE_VECTOR_RETRIEVER = "vector-retriever";
const NODE_RETRIEVAL_OUTPUT = "retrieval-output";
const NODE_INGEST_INPUT = "ingest-input";
const NODE_PARSE_DOCUMENT = "parse-document";
const NODE_CHUNK_DOCUMENT = "chunk-document";
const NODE_EMBED_CHUNKS = "embed-chunks";
const NODE_INDEX_CHUNKS = "index-chunks";
const NODE_INGEST_OUTPUT = "ingest-output";

/** Unified vector-store node types (backend selected in config). */
export const INDEXER_NODE_TYPE = "indexer.vector";
export const RETRIEVER_NODE_TYPE = "retriever.vector";

// Horizontal spacing between scaffolded nodes; matches the layout module.
const SCAFFOLD_SPACING_X = 368;

export const createId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export type DefaultDefinitionOptions = {
  indexName?: string;
  indexDimension?: number;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
};

const scaffoldPosition = (index: number) => ({ x: SCAFFOLD_SPACING_X * index, y: 0 });

export const buildDefaultDefinition = (
  kind: PipelineKind,
  backend: IndexBackend,
  options: DefaultDefinitionOptions = {},
): PipelineDefinition => {
  const indexConfig: Record<string, unknown> = { backend };
  if (typeof options.indexName === "string" && options.indexName.trim()) {
    indexConfig.index_name = options.indexName.trim();
  }
  const embedderConfig: Record<string, unknown> = {};
  if (options.embeddingModel) {
    embedderConfig.model_name = options.embeddingModel;
  }
  // Only the indexer carries the dimension. Setting it on the embedder would
  // send an explicit `dimensions` param to OpenRouter, which many embedding
  // models reject outright (no matryoshka support) -- models emit their
  // native dimension without it.
  if (typeof options.indexDimension === "number") {
    indexConfig.dimension = options.indexDimension;
  }

  if (kind === "retrieval") {
    const retrieverConfig = { ...indexConfig };
    delete retrieverConfig.dimension;
    return {
      nodes: [
        {
          id: NODE_QUERY_INPUT,
          type: "retrieval.input",
          name: "Retrieval Input",
          config: {},
          position: scaffoldPosition(0),
        },
        {
          id: NODE_EMBED_QUERY,
          type: "embedder.openrouter",
          name: "Embedder",
          config: embedderConfig,
          position: scaffoldPosition(1),
        },
        {
          id: NODE_VECTOR_RETRIEVER,
          type: RETRIEVER_NODE_TYPE,
          name: "Retriever",
          config: retrieverConfig,
          position: scaffoldPosition(2),
        },
        {
          id: NODE_RETRIEVAL_OUTPUT,
          type: "retrieval.output",
          name: "Retrieval Output",
          config: {},
          position: scaffoldPosition(3),
        },
      ],
      edges: [
        {
          id: "edge-retrieval-input",
          source: NODE_QUERY_INPUT,
          target: NODE_EMBED_QUERY,
          source_port: PORT_REQUEST,
          target_port: PORT_REQUEST,
        },
        {
          id: "edge-retrieval-embedder",
          source: NODE_EMBED_QUERY,
          target: NODE_VECTOR_RETRIEVER,
          source_port: PORT_QUERY_EMBEDDING,
          target_port: PORT_QUERY_EMBEDDING,
        },
        {
          id: "edge-retrieval-output",
          source: NODE_VECTOR_RETRIEVER,
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
        position: scaffoldPosition(0),
      },
      {
        id: NODE_PARSE_DOCUMENT,
        type: "parser.document",
        name: "Document Parser",
        config: {},
        position: scaffoldPosition(1),
      },
      {
        id: NODE_CHUNK_DOCUMENT,
        type: "chunker.token",
        name: "Token Chunker",
        config: {
          chunk_size: options.chunkSize ?? 1024,
          chunk_overlap: options.chunkOverlap ?? 200,
        },
        position: scaffoldPosition(2),
      },
      {
        id: NODE_EMBED_CHUNKS,
        type: "embedder.openrouter",
        name: "Embedder",
        config: embedderConfig,
        position: scaffoldPosition(3),
      },
      {
        id: NODE_INDEX_CHUNKS,
        type: INDEXER_NODE_TYPE,
        name: "Indexer",
        config: indexConfig,
        position: scaffoldPosition(4),
      },
      {
        id: NODE_INGEST_OUTPUT,
        type: "ingestion.output",
        name: "Ingestion Output",
        config: {},
        position: scaffoldPosition(5),
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

/**
 * Convert definition edges to typed flow edges. The wire's color comes from
 * the data type leaving the source port, resolved via the node specs.
 */
export const toFlowEdges = (definition: PipelineDefinition, specs: NodeSpec[]): TypedEdgeType[] =>
  definition.edges.map((edge) => {
    const sourceNode = definition.nodes.find((node) => node.id === edge.source);
    const spec = sourceNode ? specs.find((item) => item.type === sourceNode.type) : undefined;
    const port = spec?.output_ports.find((entry) => entry.key === edge.source_port);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.source_port ?? undefined,
      targetHandle: edge.target_port ?? undefined,
      type: "typed" as const,
      data: { dataType: port?.data_type ?? spec?.output_ports[0]?.data_type },
    };
  });

export const toPipelineDefinition = (
  nodes: Node<PipelineNodeData>[],
  edges: TypedEdgeType[],
): PipelineDefinition => ({
  nodes: nodes.map((node) => ({
    id: node.id,
    type: node.data.nodeType,
    name: node.data.label,
    config: node.data.config,
    position: { x: node.position.x, y: node.position.y },
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
      /* c8 ignore next -- filter ensures a family has specs */
      specs: catalog[family] ?? [],
    }));
};

/** Place a new node one column to the right of the current graph. */
export const nextNodePosition = (nodes: Node<PipelineNodeData>[]) => {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const maxX = Math.max(...nodes.map((node) => node.position.x));
  const rightmost = nodes.filter((node) => node.position.x === maxX);
  const avgY = rightmost.reduce((sum, node) => sum + node.position.y, 0) / rightmost.length;
  return { x: maxX + SCAFFOLD_SPACING_X, y: avgY };
};

/** Builds the flow-node `data` payload for a node spec, shared by the sidebar's drag
 * preview node and by the node actually added to the canvas. */
export const specToNodeData = (spec: NodeSpec): PipelineNodeData => ({
  label: spec.label,
  nodeType: spec.type,
  description: resolveNodeDescription(spec),
  example: resolveNodeExample(spec),
  inputs: spec.input_ports,
  outputs: spec.output_ports,
  config: spec.default_config ?? {},
  configSchema: spec.config_schema ?? {},
});

/** Sorts vector indexes alphabetically by name; used anywhere an index <select> needs a
 * stable, human-friendly ordering. */
export const sortIndexesByName = <T extends Pick<VectorIndex, "name">>(indexes: T[]): T[] =>
  [...indexes].sort((a, b) => a.name.localeCompare(b.name));
