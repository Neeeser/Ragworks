import { describe, expect, it, vi } from "vitest";

import {
  bm25SiblingIndexName,
  buildDefaultDefinition,
} from "@/components/pipelines/lib/pipeline-scaffold";
import {
  buildNodeCatalog,
  createId,
  nextNodePosition,
  toFlowEdges,
  toFlowNodes,
  toPipelineDefinition,
} from "@/components/pipelines/lib/pipeline-utils";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodeSpec, PipelineDefinition } from "@/lib/types";
import type { Node } from "@xyflow/react";

const utilityNodeType = "utility.custom";
const RETRIEVER_TYPE = "retriever.vector";
const INDEXER_TYPE = "indexer.vector";
const pipelineNodeId = "node-1";
const pipelineEdgeId = "edge-1";

describe("pipeline-utils", () => {
  it("creates ids using crypto when available", () => {
    const original = globalThis.crypto;
    const randomUUID = vi.fn(() => "uuid-123");
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID },
      configurable: true,
    });

    expect(createId()).toBe("uuid-123");
    expect(randomUUID).toHaveBeenCalled();

    Object.defineProperty(globalThis, "crypto", {
      value: original,
      configurable: true,
    });
  });

  it("creates fallback ids when crypto is missing", () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234567890);
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0.1234);

    const id = createId();
    expect(id).toMatch(/^node-/);

    nowSpy.mockRestore();
    randSpy.mockRestore();
    Object.defineProperty(globalThis, "crypto", {
      value: original,
      configurable: true,
    });
  });

  it("scaffolds unified vector nodes carrying the chosen backend in config", () => {
    const retrieval = buildDefaultDefinition("retrieval", "pgvector", { indexName: "docs" });
    const retriever = retrieval.nodes.find((node) => node.type === RETRIEVER_TYPE);
    expect(retriever?.config).toEqual({ backend: "pgvector", index_name: "docs" });
    const ingestion = buildDefaultDefinition("ingestion", "pgvector", { indexName: "docs" });
    const indexer = ingestion.nodes.find((node) => node.type === INDEXER_TYPE);
    expect(indexer?.config).toEqual({ backend: "pgvector", index_name: "docs" });
  });

  it("builds default definitions for retrieval and ingestion pipelines", () => {
    const retrieval = buildDefaultDefinition("retrieval", "pinecone", {
      indexName: "index-a",
      indexDimension: 384,
    });
    expect(retrieval.nodes).toHaveLength(4);
    expect(retrieval.edges).toHaveLength(3);
    const retriever = retrieval.nodes.find((node) => node.type === RETRIEVER_TYPE);
    expect(retriever?.config).toEqual({ backend: "pinecone", index_name: "index-a" });
    const ingestionCheck = buildDefaultDefinition("ingestion", "pinecone", {
      indexName: "index-a",
      indexDimension: 384,
    });
    const dimIndexer = ingestionCheck.nodes.find((node) => node.type === INDEXER_TYPE);
    expect(dimIndexer?.config).toEqual({
      backend: "pinecone",
      index_name: "index-a",
      dimension: 384,
    });
    const embedder = retrieval.nodes.find((node) => node.type === "embedder.openrouter");
    // The dimension never lands on the embedder: an explicit `dimensions`
    // param is rejected by most OpenRouter embedding models.
    expect(embedder?.config).toEqual({});
    expect(retrieval.edges).toContainEqual(
      expect.objectContaining({
        source: embedder?.id,
        target: retriever?.id,
        source_port: "query_embedding",
        target_port: "query_embedding",
      }),
    );

    const ingestion = buildDefaultDefinition("ingestion", "pinecone", {
      indexName: "index-b",
      chunkSize: 512,
      chunkOverlap: 32,
      embeddingModel: "openai/text-embedding-3-small",
    });
    expect(ingestion.nodes).toHaveLength(6);
    expect(ingestion.edges).toHaveLength(5);
    const indexer = ingestion.nodes.find((node) => node.type === INDEXER_TYPE);
    expect(indexer?.config).toEqual({ backend: "pinecone", index_name: "index-b" });
    const chunker = ingestion.nodes.find((node) => node.type === "chunker.token");
    expect(chunker?.config).toEqual({ chunk_size: 512, chunk_overlap: 32 });
    const ingestEmbedder = ingestion.nodes.find((node) => node.type === "embedder.openrouter");
    expect(ingestEmbedder?.config).toEqual({ model_name: "openai/text-embedding-3-small" });
  });

  it("omits index name config when it is blank", () => {
    const ingestion = buildDefaultDefinition("ingestion", "pinecone", { indexName: "   " });
    const indexer = ingestion.nodes.find((node) => node.type === INDEXER_TYPE);
    expect(indexer?.config).toEqual({ backend: "pinecone" });
  });

  it("maps pipeline definitions to flow nodes and edges", () => {
    const definition: PipelineDefinition = {
      nodes: [
        {
          id: "n1",
          type: "ingestion.input",
          name: "Input",
          config: { source: "file" },
          position: { x: 10, y: 20 },
        },
        {
          id: "n2",
          type: "custom.node",
          name: "Custom",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "n1",
          target: "n2",
          source_port: "source",
          target_port: "document",
        },
      ],
      viewport: {},
    };
    const specs: NodeSpec[] = [
      {
        type: "ingestion.input",
        label: "Input",
        category: "ingestion",
        description: "fallback",
        example: "example",
        input_ports: [
          {
            key: "source",
            label: "Source",
            data_type: "document_source",
            required: true,
            accepts_many: false,
          },
        ],
        output_ports: [
          {
            key: "document",
            label: "Document",
            data_type: "document",
            required: true,
            accepts_many: false,
          },
        ],
        config_schema: { input: { type: "string" } },
        default_config: {},
        hidden: false,
      },
    ];

    const nodes = toFlowNodes(definition, specs);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].data.label).toBe("Input");
    expect(nodes[0].data.description).toContain("Starts ingestion");
    expect(nodes[1].data.description).toBeUndefined();

    const edges = toFlowEdges(definition, specs);
    expect(edges).toEqual([
      expect.objectContaining({
        id: "e1",
        source: "n1",
        target: "n2",
        sourceHandle: "source",
        targetHandle: "document",
        type: "typed",
        data: { dataType: "document" },
      }),
    ]);

    const edgesWithoutHandles = toFlowEdges(
      {
        ...definition,
        edges: [{ id: "e2", source: "n1", target: "n2" }],
      },
      specs,
    );
    expect(edgesWithoutHandles[0]?.sourceHandle).toBeUndefined();
    expect(edgesWithoutHandles[0]?.targetHandle).toBeUndefined();
    // Falls back to the source node's first output type for the wire color.
    expect(edgesWithoutHandles[0]?.data?.dataType).toBe("document");
  });

  it("defaults missing node position and config when mapping to flow nodes", () => {
    const definition = {
      nodes: [
        {
          id: "node-a",
          type: "parser.document",
          name: "Parser",
        },
      ],
      edges: [],
      viewport: {},
    } as unknown as PipelineDefinition;
    const nodes = toFlowNodes(definition, []);
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(nodes[0].data.config).toEqual({});
  });

  it("maps flow nodes and edges back to pipeline definitions", () => {
    const nodes: Node<PipelineNodeData>[] = [
      {
        id: pipelineNodeId,
        type: "pipelineNode",
        position: { x: 1, y: 2 },
        data: {
          label: "Label",
          nodeType: utilityNodeType,
          inputs: [],
          outputs: [],
          config: { foo: "bar" },
        },
      },
    ];
    const edges = [
      {
        id: pipelineEdgeId,
        source: pipelineNodeId,
        target: pipelineNodeId,
        sourceHandle: "source",
        targetHandle: "target",
      },
    ];

    const definition = toPipelineDefinition(nodes, edges);
    expect(definition.nodes[0]).toEqual(
      expect.objectContaining({
        id: pipelineNodeId,
        type: utilityNodeType,
        name: "Label",
        config: { foo: "bar" },
      }),
    );
    expect(definition.edges[0]).toEqual(
      expect.objectContaining({
        id: pipelineEdgeId,
        source_port: "source",
        target_port: "target",
      }),
    );

    const definitionWithoutHandles = toPipelineDefinition(nodes, [
      { id: "edge-2", source: pipelineNodeId, target: pipelineNodeId },
    ]);
    expect(definitionWithoutHandles.edges[0]?.source_port).toBeUndefined();
    expect(definitionWithoutHandles.edges[0]?.target_port).toBeUndefined();
  });

  it("builds node catalogs in family order and places new nodes one column right", () => {
    const specs: NodeSpec[] = [
      {
        type: RETRIEVER_TYPE,
        label: "Retriever",
        category: "retrieval",
        description: "",
        example: "",
        input_ports: [],
        output_ports: [],
        config_schema: {},
        default_config: {},
        hidden: false,
      },
      {
        type: "chunker.token",
        label: "Chunker",
        category: "ingestion",
        description: "",
        example: "",
        input_ports: [],
        output_ports: [],
        config_schema: {},
        default_config: {},
        hidden: false,
      },
      {
        type: utilityNodeType,
        label: "Utility",
        category: "utility",
        description: "",
        example: "",
        input_ports: [],
        output_ports: [],
        config_schema: {},
        default_config: {},
        hidden: false,
      },
    ];

    const catalog = buildNodeCatalog(specs);
    expect(catalog.map((entry) => entry.family)).toEqual(["chunker", "retriever", "utility"]);

    expect(nextNodePosition([])).toEqual({ x: 0, y: 0 });
    const placed = nextNodePosition([
      {
        id: "a",
        type: "pipelineNode",
        position: { x: 368, y: 40 },
        data: {
          label: "A",
          nodeType: utilityNodeType,
          inputs: [],
          outputs: [],
          config: {},
        },
      },
    ]);
    expect(placed).toEqual({ x: 736, y: 40 });
  });
});

describe("hybrid BM25 scaffolding", () => {
  it("scaffolds the BM25 branch with a derived sibling index when included", () => {
    const ingestion = buildDefaultDefinition("ingestion", "pgvector", {
      indexName: "docs",
      includeBm25: true,
    });
    const bm25Indexer = ingestion.nodes.find((node) => node.type === "indexer.bm25");
    expect(bm25Indexer?.config).toEqual({ backend: "pgvector", index_name: "docs-bm25" });
    expect(ingestion.edges).toContainEqual(
      expect.objectContaining({ source: "chunk-document", target: "index-bm25" }),
    );
    expect(ingestion.edges).toContainEqual(
      expect.objectContaining({ source: "index-bm25", target: "ingest-output" }),
    );
    const ingestionOutput = ingestion.nodes.find((node) => node.id === "ingest-output");
    expect(ingestionOutput?.position?.y).toBe(130);

    const retrieval = buildDefaultDefinition("retrieval", "pgvector", {
      indexName: "docs",
      includeBm25: true,
    });
    const bm25Retriever = retrieval.nodes.find((node) => node.type === "retriever.bm25");
    expect(bm25Retriever?.config).toEqual({ backend: "pgvector", index_name: "docs-bm25" });
    const fusion = retrieval.nodes.find((node) => node.type === "fusion.rrf");
    expect(fusion).toBeDefined();
    // Both retriever branches feed the fusion node, which feeds the output.
    const fusionTargets = retrieval.edges.filter((edge) => edge.target === fusion?.id);
    expect(fusionTargets.map((edge) => edge.source).sort()).toEqual([
      "bm25-retriever",
      "vector-retriever",
    ]);
    expect(retrieval.edges).toContainEqual(
      expect.objectContaining({ source: fusion?.id, target: "retrieval-output" }),
    );
  });

  it("omits the BM25 branch when the deployment cannot serve sparse indexes", () => {
    const ingestion = buildDefaultDefinition("ingestion", "pgvector", { indexName: "docs" });
    expect(ingestion.nodes.some((node) => node.type === "indexer.bm25")).toBe(false);
    const retrieval = buildDefaultDefinition("retrieval", "pgvector", { indexName: "docs" });
    expect(retrieval.nodes.some((node) => node.type === "fusion.rrf")).toBe(false);
    // Without fusion, the semantic retriever feeds the output directly.
    expect(retrieval.edges).toContainEqual(
      expect.objectContaining({ source: "vector-retriever", target: "retrieval-output" }),
    );
  });

  it("derives BM25 sibling names within the backend's own name-length cap", () => {
    const sibling = bm25SiblingIndexName("a".repeat(30), 20);
    expect(sibling.length).toBeLessThanOrEqual(20);
    expect(sibling.endsWith("-bm25")).toBe(true);
  });

  it("derives BM25 sibling names within the 45-character index name rule", () => {
    expect(bm25SiblingIndexName("docs")).toBe("docs-bm25");
    const long = "a".repeat(45);
    const sibling = bm25SiblingIndexName(long);
    expect(sibling.length).toBeLessThanOrEqual(45);
    expect(sibling.endsWith("-bm25")).toBe(true);
    expect(bm25SiblingIndexName("abc----------------------------------------x")).toMatch(
      /[a-z0-9]-bm25$/,
    );
  });
});
