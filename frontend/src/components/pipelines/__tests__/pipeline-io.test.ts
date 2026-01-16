import { describe, expect, it } from "vitest";

import {
  validatePipelineConfig,
  validatePipelineConnection,
  validatePipelineEdges,
} from "@/components/pipelines/pipeline-io";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { Connection, Node } from "@xyflow/react";

const parserNodeType = "parser.document";
const chunkerNodeType = "chunker.token";
const embedderNodeType = "embedder.openrouter";
const indexerNodeType = "indexer.pinecone";
const retrieverNodeType = "retriever.pinecone";

const buildNode = (data: Partial<PipelineNodeData> & { nodeType: string }, id = data.nodeType) =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: {
      label: data.nodeType,
      nodeType: data.nodeType,
      inputs: data.inputs ?? [],
      outputs: data.outputs ?? [],
      config: data.config ?? {},
      configSchema: data.configSchema,
    },
  }) as Node<PipelineNodeData>;

describe("pipeline-io", () => {
  it("validates missing connection data and self connections", () => {
    const nodes: Node<PipelineNodeData>[] = [];
    const noTarget: Connection = { source: "a", target: null };
    expect(validatePipelineConnection(noTarget, nodes)).toEqual(
      expect.objectContaining({ valid: false }),
    );
    const self: Connection = { source: "a", target: "a" };
    expect(validatePipelineConnection(self, nodes)).toEqual(
      expect.objectContaining({ valid: false }),
    );
  });

  it("validates incompatible ports and missing handles", () => {
    const nodes = [
      buildNode({
        nodeType: parserNodeType,
        outputs: [{ key: "out", label: "Out", data_type: "document", required: true }],
      }),
      buildNode({
        nodeType: chunkerNodeType,
        inputs: [{ key: "in", label: "In", data_type: "chunk_batch", required: true }],
      }),
    ];
    const missingHandle: Connection = {
      source: parserNodeType,
      target: chunkerNodeType,
    };
    expect(validatePipelineConnection(missingHandle, nodes).valid).toBe(false);

    const incompatible: Connection = {
      source: parserNodeType,
      target: chunkerNodeType,
      sourceHandle: "out",
      targetHandle: "in",
    };
    const result = validatePipelineConnection(incompatible, nodes);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cannot connect");
  });

  it("validates dimension mismatches", () => {
    const nodes = [
      buildNode({
        nodeType: embedderNodeType,
        outputs: [{ key: "emb", label: "Emb", data_type: "embedded_batch", required: true }],
        config: { dimension: 768 },
      }),
      buildNode({
        nodeType: indexerNodeType,
        inputs: [{ key: "emb", label: "Emb", data_type: "embedded_batch", required: true }],
        config: { dimension: 384 },
      }),
    ];
    const connection: Connection = {
      source: embedderNodeType,
      target: indexerNodeType,
      sourceHandle: "emb",
      targetHandle: "emb",
    };
    const result = validatePipelineConnection(connection, nodes);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("does not match");

    const edgeValidation = validatePipelineEdges(nodes, [
      { id: "edge-1", source: embedderNodeType, target: indexerNodeType },
    ]);
    expect(edgeValidation.edgeErrors["edge-1"]).toContain("Embedding dimension");
    expect(edgeValidation.nodeErrors[indexerNodeType][0]).toContain("Embedding dimension");
  });

  it("uses config overrides when validating dimensions", () => {
    const nodes = [
      buildNode({
        nodeType: embedderNodeType,
        outputs: [{ key: "emb", label: "Emb", data_type: "embedded_batch", required: true }],
        config: {},
      }),
      buildNode({
        nodeType: indexerNodeType,
        inputs: [{ key: "emb", label: "Emb", data_type: "embedded_batch", required: true }],
        config: {},
      }),
    ];
    const connection: Connection = {
      source: embedderNodeType,
      target: indexerNodeType,
      sourceHandle: "emb",
      targetHandle: "emb",
    };
    const result = validatePipelineConnection(connection, nodes, {
      [embedderNodeType]: { dimension: 256 },
      [indexerNodeType]: { dimension: 512 },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Embedding dimension");
  });

  it("skips dimension validation when dimensions are not finite", () => {
    const nodes = [
      buildNode({
        nodeType: embedderNodeType,
        outputs: [{ key: "emb", label: "Emb", data_type: "embedded_batch", required: true }],
        config: { dimension: Number.POSITIVE_INFINITY },
      }),
      buildNode({
        nodeType: indexerNodeType,
        inputs: [{ key: "emb", label: "Emb", data_type: "embedded_batch", required: true }],
        config: { dimension: 384 },
      }),
    ];
    const connection: Connection = {
      source: embedderNodeType,
      target: indexerNodeType,
      sourceHandle: "emb",
      targetHandle: "emb",
    };
    expect(validatePipelineConnection(connection, nodes).valid).toBe(true);
  });

  it("skips dimension validation when nodes are missing or types do not match", () => {
    const nodes: Node<PipelineNodeData>[] = [
      buildNode({
        nodeType: embedderNodeType,
        outputs: [{ key: "emb", label: "Emb", data_type: "embedded_batch", required: true }],
      }),
      buildNode({
        nodeType: retrieverNodeType,
        inputs: [{ key: "emb", label: "Emb", data_type: "embedded_batch", required: true }],
      }),
    ];
    const connection: Connection = {
      source: embedderNodeType,
      target: retrieverNodeType,
      sourceHandle: "emb",
      targetHandle: "emb",
    };
    const result = validatePipelineConnection(connection, nodes);
    expect(result.valid).toBe(true);

    const edgeValidation = validatePipelineEdges(
      [],
      [{ id: "edge-missing", source: "missing", target: "missing-2" }],
    );
    expect(edgeValidation.edgeErrors).toEqual({});
  });

  it("falls back to direct type compatibility when no map entry exists", () => {
    const nodes = [
      buildNode({
        nodeType: "custom.source",
        outputs: [{ key: "out", label: "Out", data_type: "custom", required: true }],
      }),
      buildNode({
        nodeType: "custom.target",
        inputs: [{ key: "in", label: "In", data_type: "other", required: true }],
      }),
    ];
    const connection: Connection = {
      source: "custom.source",
      target: "custom.target",
      sourceHandle: "out",
      targetHandle: "in",
    };
    const result = validatePipelineConnection(connection, nodes);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cannot connect");
  });

  it("returns valid connections when ports are compatible", () => {
    const nodes = [
      buildNode({
        nodeType: parserNodeType,
        outputs: [{ key: "out", label: "Out", data_type: "document", required: true }],
      }),
      buildNode(
        {
          nodeType: parserNodeType,
          inputs: [{ key: "in", label: "In", data_type: "document", required: true }],
        },
        `${parserNodeType}.2`,
      ),
    ];
    const connection: Connection = {
      source: parserNodeType,
      target: `${parserNodeType}.2`,
      sourceHandle: "out",
      targetHandle: "in",
    };
    const result = validatePipelineConnection(connection, nodes);
    expect(result.valid).toBe(true);
  });

  it("uses config overrides when validating index config", () => {
    const nodes = [
      buildNode({
        nodeType: indexerNodeType,
        config: { index_name: "" },
      }),
    ];
    const overrides = { [indexerNodeType]: { index_name: "alpha" } };
    const result = validatePipelineConfig(nodes, overrides);
    expect(result.nodeErrors).toEqual({});
  });

  it("falls back to node config when overrides do not match", () => {
    const nodes = [
      buildNode(
        {
          nodeType: indexerNodeType,
          config: { index_name: "alpha" },
        },
        "indexer",
      ),
    ];
    const overrides = { other: { index_name: "beta" } };
    const result = validatePipelineConfig(nodes, overrides);
    expect(result.nodeErrors).toEqual({});
  });

  it("validates required pinecone index names", () => {
    const nodes = [
      buildNode({ nodeType: indexerNodeType, config: {} }, "indexer"),
      buildNode({ nodeType: retrieverNodeType, config: { index_name: "" } }, "retriever"),
      buildNode({ nodeType: parserNodeType, config: {} }, "parser"),
    ];

    const { nodeErrors } = validatePipelineConfig(nodes);
    expect(nodeErrors.indexer[0]).toContain("Pinecone index is required");
    expect(nodeErrors.retriever[0]).toContain("Pinecone index is required");
    expect(nodeErrors.parser).toBeUndefined();

    const overrides = { retriever: { index_name: "index-a" } };
    expect(validatePipelineConfig(nodes, overrides).nodeErrors.retriever).toBeUndefined();
  });
});
