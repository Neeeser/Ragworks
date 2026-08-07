import { describe, expect, it } from "vitest";

import {
  validatePipelineConfig,
  validatePipelineConnection,
  validatePipelineEdges,
} from "@/components/pipelines/lib/pipeline-io";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { Connection, Node } from "@xyflow/react";

const parserNodeType = "parse.text";
const chunkerNodeType = "chunker.token";
const embedderNodeType = "embedder.text";
const indexerNodeType = "indexer.pinecone";
const retrieverNodeType = "retriever.pinecone";
const EMBEDDING_DIMENSION_ERROR = "Embedding dimension";
const INDEX_REQUIRED = "An index is required";

const buildNode = (data: Partial<PipelineNodeData> & { nodeType: string }, id = data.nodeType) =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: {
      label: data.label ?? data.nodeType,
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
    const noTarget = {
      source: "a",
      target: null,
      sourceHandle: null,
      targetHandle: null,
    } as unknown as Connection;
    expect(validatePipelineConnection(noTarget, nodes)).toEqual(
      expect.objectContaining({ valid: false }),
    );
    const self: Connection = {
      source: "a",
      target: "a",
      sourceHandle: null,
      targetHandle: null,
    };
    expect(validatePipelineConnection(self, nodes)).toEqual(
      expect.objectContaining({ valid: false }),
    );
  });

  it("validates incompatible ports and missing handles", () => {
    const nodes = [
      buildNode({
        nodeType: parserNodeType,
        outputs: [
          {
            key: "out",
            label: "Out",
            data_type: "structured_values",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
      }),
      buildNode({
        nodeType: chunkerNodeType,
        inputs: [
          {
            key: "in",
            label: "In",
            data_type: "chunk_batch",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
      }),
    ];
    const missingHandle: Connection = {
      source: parserNodeType,
      target: chunkerNodeType,
      sourceHandle: null,
      targetHandle: null,
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
        outputs: [
          {
            key: "emb",
            label: "Emb",
            data_type: "embedded_batch",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
        config: { dimension: 768 },
      }),
      buildNode({
        nodeType: indexerNodeType,
        inputs: [
          {
            key: "emb",
            label: "Emb",
            data_type: "embedded_batch",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
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
    expect(edgeValidation.edgeErrors["edge-1"]).toContain(EMBEDDING_DIMENSION_ERROR);
    expect(edgeValidation.nodeErrors[indexerNodeType][0]).toContain(EMBEDDING_DIMENSION_ERROR);
  });

  it("uses config overrides when validating dimensions", () => {
    const nodes = [
      buildNode({
        nodeType: embedderNodeType,
        outputs: [
          {
            key: "emb",
            label: "Emb",
            data_type: "embedded_batch",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
        config: {},
      }),
      buildNode({
        nodeType: indexerNodeType,
        inputs: [
          {
            key: "emb",
            label: "Emb",
            data_type: "embedded_batch",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
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
    expect(result.reason).toContain(EMBEDDING_DIMENSION_ERROR);
  });

  it("skips dimension validation when dimensions are not finite", () => {
    const nodes = [
      buildNode({
        nodeType: embedderNodeType,
        outputs: [
          {
            key: "emb",
            label: "Emb",
            data_type: "embedded_batch",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
        config: { dimension: Number.POSITIVE_INFINITY },
      }),
      buildNode({
        nodeType: indexerNodeType,
        inputs: [
          {
            key: "emb",
            label: "Emb",
            data_type: "embedded_batch",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
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
        outputs: [
          {
            key: "emb",
            label: "Emb",
            data_type: "embedded_batch",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
      }),
      buildNode({
        nodeType: retrieverNodeType,
        inputs: [
          {
            key: "emb",
            label: "Emb",
            data_type: "embedded_batch",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
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
        outputs: [
          {
            key: "out",
            label: "Out",
            data_type: "custom",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
      }),
      buildNode({
        nodeType: "custom.target",
        inputs: [
          {
            key: "in",
            label: "In",
            data_type: "other",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
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
        outputs: [
          {
            key: "out",
            label: "Out",
            data_type: "structured_values",
            required: true,
            accepts_many: false,
            requires: [],
            adds: [],
            accepts: [],
            unaccepted: "passthrough" as const,
            preserves: false,
            removes: [],
          },
        ],
      }),
      buildNode(
        {
          nodeType: parserNodeType,
          inputs: [
            {
              key: "in",
              label: "In",
              data_type: "structured_values",
              required: true,
              accepts_many: false,
              requires: [],
              adds: [],
              accepts: [],
              unaccepted: "passthrough" as const,
              preserves: false,
              removes: [],
            },
          ],
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
    expect(nodeErrors.indexer[0]).toContain(INDEX_REQUIRED);
    expect(nodeErrors.retriever[0]).toContain(INDEX_REQUIRED);
    expect(nodeErrors.parser).toBeUndefined();

    const overrides = { retriever: { index_name: "index-a" } };
    expect(validatePipelineConfig(nodes, overrides).nodeErrors.retriever).toBeUndefined();
  });

  it("validates the HuggingFace tokenizer model id", () => {
    const nodes = [
      buildNode(
        { nodeType: "chunker.token", config: { tokenizer: "huggingface", hf_model_id: "" } },
        "chunker",
      ),
    ];

    expect(validatePipelineConfig(nodes).nodeErrors.chunker[0]).toContain("model id is required");
    expect(
      validatePipelineConfig(nodes, {
        chunker: { tokenizer: "huggingface", hf_model_id: "owner/model" },
      }).nodeErrors,
    ).toEqual({});
  });
});

describe("port fan-in", () => {
  const SINGLE_TARGET = "single-target";
  const FUSION_TARGET = "fusion-target";
  const resultsPort = (acceptsMany: boolean) => ({
    key: "results",
    label: "Results",
    data_type: "retrieval_results",
    required: true,
    accepts_many: acceptsMany,
    requires: [],
    adds: [],
    accepts: [],
    unaccepted: "passthrough" as const,
    preserves: false,
    removes: [],
  });
  const sourceA = buildNode(
    { nodeType: "retriever.vector", outputs: [resultsPort(false)] },
    "source-a",
  );
  const sourceB = buildNode(
    { nodeType: "retriever.bm25", outputs: [resultsPort(false)] },
    "source-b",
  );
  const singleTarget = buildNode(
    { nodeType: "retrieval.output", inputs: [resultsPort(false)] },
    SINGLE_TARGET,
  );
  const fusionTarget = buildNode(
    { nodeType: "fusion.rrf", inputs: [resultsPort(true)] },
    FUSION_TARGET,
  );

  it("reports a second edge into a single-value input port as a replacement", () => {
    const nodes = [sourceA, sourceB, singleTarget];
    const existingEdges = [
      { id: "edge-1", source: "source-a", target: SINGLE_TARGET, targetHandle: "results" },
    ];
    const connection: Connection = {
      source: "source-b",
      target: SINGLE_TARGET,
      sourceHandle: "results",
      targetHandle: "results",
    };

    const result = validatePipelineConnection(connection, nodes, undefined, existingEdges);

    expect(result.valid).toBe(true);
    expect(result.replaces).toEqual(["edge-1"]);
  });

  it("replaces nothing when the single-value input port is free", () => {
    const nodes = [sourceA, sourceB, singleTarget];
    const connection: Connection = {
      source: "source-b",
      target: SINGLE_TARGET,
      sourceHandle: "results",
      targetHandle: "results",
    };

    const result = validatePipelineConnection(connection, nodes, undefined, []);

    expect(result.valid).toBe(true);
    expect(result.replaces).toEqual([]);
  });

  it("allows any number of edges into an accepts_many port", () => {
    const nodes = [sourceA, sourceB, fusionTarget];
    const existingEdges = [
      { id: "edge-1", source: "source-a", target: FUSION_TARGET, targetHandle: "results" },
    ];
    const connection: Connection = {
      source: "source-b",
      target: FUSION_TARGET,
      sourceHandle: "results",
      targetHandle: "results",
    };

    const result = validatePipelineConnection(connection, nodes, undefined, existingEdges);

    expect(result.valid).toBe(true);
    expect(result.replaces).toEqual([]);
  });
});

describe("cycles on the canvas", () => {
  const cyclicNodes = [
    buildNode({ nodeType: chunkerNodeType, label: "Chunker" }, "a"),
    buildNode({ nodeType: embedderNodeType, label: "Embedder" }, "b"),
  ];

  it("marks every edge in a loop and names the loop on the nodes", () => {
    const { edgeErrors, nodeErrors } = validatePipelineEdges(cyclicNodes, [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "a" },
    ]);

    // A loop otherwise surfaces only as an inability to save, minutes after
    // the wire was drawn.
    expect(Object.keys(edgeErrors).sort()).toEqual(["e1", "e2"]);
    expect(edgeErrors.e1).toContain("creates a loop");
    // Named by what the canvas shows, not by node id.
    expect(edgeErrors.e1).toContain("Chunker → Embedder → Chunker");
    expect(nodeErrors.a?.[0]).toContain("creates a loop");
  });

  it("clears itself when the loop is cut, because nothing is stored", () => {
    const { edgeErrors, nodeErrors } = validatePipelineEdges(cyclicNodes, [
      { id: "e1", source: "a", target: "b" },
    ]);

    expect(edgeErrors).toEqual({});
    expect(nodeErrors).toEqual({});
  });
});

describe("required settings across node types", () => {
  it("flags an embedder with no model, as it flags a retriever with no index", () => {
    const { nodeErrors } = validatePipelineConfig([
      buildNode({ nodeType: embedderNodeType, config: {} }, "embed"),
      buildNode({ nodeType: retrieverNodeType, config: {} }, "retrieve"),
    ]);

    // Both are equally unrunnable, so both report on the same frame — one of
    // them reporting a debounce later reads as the other being fine.
    expect(nodeErrors.embed).toEqual(["An embedding model is required. Select one."]);
    expect(nodeErrors.retrieve?.[0]).toContain(INDEX_REQUIRED);
  });

  it("flags an embedder that names a model but no connection to serve it", () => {
    const { nodeErrors } = validatePipelineConfig([
      buildNode({ nodeType: embedderNodeType, config: { model_name: "m" } }, "embed"),
    ]);

    expect(nodeErrors.embed).toEqual(["A provider connection is required. Select one."]);
  });

  it("passes a fully configured embedder", () => {
    const { nodeErrors } = validatePipelineConfig([
      buildNode(
        { nodeType: embedderNodeType, config: { model_name: "m", connection_id: "c" } },
        "embed",
      ),
    ]);

    expect(nodeErrors.embed).toBeUndefined();
  });
});
