import { describe, expect, it, vi } from "vitest";

import {
  buildDefaultDefinition,
  buildNodeCatalog,
  createDefaultNodePosition,
  createId,
  toFlowEdges,
  toFlowNodes,
  toPipelineDefinition,
} from "@/components/pipelines/lib/pipeline-utils";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodeSpec, PipelineDefinition } from "@/lib/types";
import type { Node } from "@xyflow/react";

const utilityNodeType = "utility.custom";
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

  it("builds pgvector node types when the pgvector backend is chosen", () => {
    const retrieval = buildDefaultDefinition("retrieval", "pgvector", "docs", 384);
    expect(retrieval.nodes.some((node) => node.type === "retriever.pgvector")).toBe(true);
    const ingestion = buildDefaultDefinition("ingestion", "pgvector", "docs");
    expect(ingestion.nodes.some((node) => node.type === "indexer.pgvector")).toBe(true);
  });

  it("builds default definitions for retrieval and ingestion pipelines", () => {
    const retrieval = buildDefaultDefinition("retrieval", "pinecone", "index-a", 384);
    expect(retrieval.nodes).toHaveLength(4);
    expect(retrieval.edges).toHaveLength(3);
    const retriever = retrieval.nodes.find((node) => node.type === "retriever.pinecone");
    expect(retriever?.config).toEqual({ index_name: "index-a", dimension: 384 });
    const embedder = retrieval.nodes.find((node) => node.type === "embedder.openrouter");
    expect(embedder).toBeDefined();
    expect(retrieval.edges).toContainEqual(
      expect.objectContaining({
        source: embedder?.id,
        target: retriever?.id,
        source_port: "query_embedding",
        target_port: "query_embedding",
      }),
    );

    const ingestion = buildDefaultDefinition("ingestion", "pinecone", "index-b");
    expect(ingestion.nodes).toHaveLength(6);
    expect(ingestion.edges).toHaveLength(5);
    const indexer = ingestion.nodes.find((node) => node.type === "indexer.pinecone");
    expect(indexer?.config).toEqual({ index_name: "index-b" });
  });

  it("omits index config when the index name is empty", () => {
    const ingestion = buildDefaultDefinition("ingestion", "pinecone", "   ");
    const indexer = ingestion.nodes.find((node) => node.type === "indexer.pinecone");
    expect(indexer?.config).toEqual({});
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
          { key: "source", label: "Source", data_type: "document_source", required: true },
        ],
        output_ports: [
          { key: "document", label: "Document", data_type: "document", required: true },
        ],
        config_schema: { input: { type: "string" } },
        default_config: {},
      },
    ];

    const nodes = toFlowNodes(definition, specs);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].data.label).toBe("Input");
    expect(nodes[0].data.description).toContain("Starts ingestion");
    expect(nodes[1].data.description).toBeUndefined();

    const edges = toFlowEdges(definition);
    expect(edges).toEqual([
      expect.objectContaining({
        id: "e1",
        source: "n1",
        target: "n2",
        sourceHandle: "source",
        targetHandle: "document",
        type: "smoothstep",
      }),
    ]);

    const edgesWithoutHandles = toFlowEdges({
      ...definition,
      edges: [{ id: "e2", source: "n1", target: "n2" }],
    });
    expect(edgesWithoutHandles[0]?.sourceHandle).toBeUndefined();
    expect(edgesWithoutHandles[0]?.targetHandle).toBeUndefined();
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

  it("builds node catalogs in family order and creates default positions", () => {
    const specs: NodeSpec[] = [
      {
        type: "retriever.pinecone",
        label: "Retriever",
        category: "retrieval",
        description: "",
        example: "",
        input_ports: [],
        output_ports: [],
        config_schema: {},
        default_config: {},
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
      },
    ];

    const catalog = buildNodeCatalog(specs);
    expect(catalog.map((entry) => entry.family)).toEqual(["chunker", "retriever", "utility"]);

    expect(createDefaultNodePosition(2)).toEqual({ x: 160, y: 420 });
  });
});
