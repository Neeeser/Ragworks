import { describe, expect, it } from "vitest";

import { resolveNodeDimensions } from "@/components/pipelines/lib/pipeline-layout";
import { buildTraceGraph } from "@/components/traces/trace-graph";
import { makeNodeRunTrace, makeNodeSpec, makeTraceResponse } from "@/test/fixtures";

import type { PipelineTraceResponse } from "@/lib/types";

const INDEXER_TYPE = "indexer.vector";
const RETRIEVER_TYPE = "retriever.vector";
const BM25_INDEXER_TYPE = "indexer.bm25";
const BM25_RETRIEVER_TYPE = "retriever.bm25";
const INGEST_RUN = "ingest-run";
const STORE_ID = "index::store";
const LEXICAL_INDEX_ID = "lexical-index";
const LEXICAL_RETRIEVER_ID = "lexical-retrieve";

const nodeSpecs = [
  makeNodeSpec({ type: INDEXER_TYPE, category: "ingestion" }),
  makeNodeSpec({ type: RETRIEVER_TYPE, category: "retrieval" }),
  makeNodeSpec({ type: BM25_INDEXER_TYPE, category: "ingestion" }),
  makeNodeSpec({ type: BM25_RETRIEVER_TYPE, category: "retrieval" }),
];

const ingestionTrace = (): PipelineTraceResponse =>
  makeTraceResponse({
    run: { ...makeTraceResponse().run, id: INGEST_RUN, kind: "ingestion" },
    definition: {
      nodes: [
        { id: "parse", type: "parser.document", name: "Parser", config: {} },
        { id: "index", type: INDEXER_TYPE, name: "Indexer", config: {} },
      ],
      edges: [{ id: "e", source: "parse", target: "index" }],
    },
    node_runs: [
      makeNodeRunTrace({ id: "r1", run_id: INGEST_RUN, node_id: "parse", sequence_index: 0 }),
      makeNodeRunTrace({ id: "r2", run_id: INGEST_RUN, node_id: "index", sequence_index: 1 }),
    ],
  });

const retrievalTrace = (): PipelineTraceResponse =>
  makeTraceResponse({
    definition: {
      nodes: [
        { id: "retrieve", type: RETRIEVER_TYPE, name: "Retriever", config: {} },
        { id: "out", type: "retrieval.output", name: "Output", config: {} },
      ],
      edges: [{ id: "e", source: "retrieve", target: "out" }],
    },
    node_runs: [
      makeNodeRunTrace({ id: "r3", node_id: "retrieve", sequence_index: 0 }),
      makeNodeRunTrace({ id: "r4", node_id: "out", sequence_index: 1 }),
    ],
  });

describe("buildTraceGraph", () => {
  it("returns just the retrieval graph when there is no origin", () => {
    const graph = buildTraceGraph(retrievalTrace(), null, nodeSpecs);

    expect(graph.combined).toBe(false);
    expect(graph.steps.map((step) => step.stage)).toEqual(["retrieval", "retrieval"]);
    expect(graph.steps[0].stageLabel).toBe("Retrieval");
    expect(graph.nodes.some((node) => node.id === STORE_ID)).toBe(false);
  });

  it("labels a solo ingestion trace as ingestion, not retrieval", () => {
    const graph = buildTraceGraph(ingestionTrace(), null, nodeSpecs);

    expect(graph.combined).toBe(false);
    expect(graph.steps[0].stage).toBe("origin");
    expect(graph.steps[0].stageLabel).toBe("Ingestion");
  });

  it("joins ingestion and retrieval as isolated bands sharing an index store", () => {
    const graph = buildTraceGraph(retrievalTrace(), ingestionTrace(), nodeSpecs);

    expect(graph.combined).toBe(true);
    // Ingestion steps come first, then retrieval — the end-to-end order.
    expect(graph.steps.map((step) => step.stage)).toEqual([
      "origin",
      "origin",
      "retrieval",
      "retrieval",
    ]);
    // Pipeline node ids are prefixed per stage so the two graphs never collide.
    expect(
      graph.nodes
        .filter((node) => node.id !== STORE_ID)
        .every((node) => /^(origin|retrieval)::/.test(node.id)),
    ).toBe(true);
    // The pipelines stay isolated: no wire connects a node in one band directly
    // to a node in the other — they meet only through the shared index store.
    const directCrossWire = graph.edges.some(
      (edge) => edge.source.startsWith("origin::") && edge.target.startsWith("retrieval::"),
    );
    expect(directCrossWire).toBe(false);

    expect(graph.nodes.some((node) => node.id === STORE_ID)).toBe(true);
    const write = graph.edges.find((edge) => edge.id === "index::write");
    const read = graph.edges.find((edge) => edge.id === "index::read");
    expect(write?.source).toBe("origin::index");
    expect(write?.target).toBe(STORE_ID);
    expect(read?.source).toBe(STORE_ID);
    expect(read?.target).toBe("retrieval::retrieve");
    // The store is a datastore, not an executed node — never a playback step.
    expect(graph.steps.some((step) => step.nodeId === STORE_ID)).toBe(false);
  });

  it("gives the index store explicit dimensions so geometry never estimates it", () => {
    const graph = buildTraceGraph(retrievalTrace(), ingestionTrace(), nodeSpecs);
    const store = graph.nodes.find((node) => node.id === STORE_ID);

    // estimateNodeHeight reads PipelineNodeData ports the store doesn't have;
    // resolveNodeDimensions must short-circuit on these instead of crashing.
    expect(store?.width).toBeGreaterThan(0);
    expect(store?.height).toBeGreaterThan(0);
    expect(() => resolveNodeDimensions(store!)).not.toThrow();
    expect(resolveNodeDimensions(store!)).toEqual({ width: store?.width, height: store?.height });
  });

  it("stacks the retrieval band below the ingestion band", () => {
    const graph = buildTraceGraph(retrievalTrace(), ingestionTrace(), nodeSpecs);
    const originMaxY = Math.max(
      ...graph.nodes.filter((n) => n.id.startsWith("origin::")).map((n) => n.position.y),
    );
    const retrievalMinY = Math.min(
      ...graph.nodes.filter((n) => n.id.startsWith("retrieval::")).map((n) => n.position.y),
    );
    expect(retrievalMinY).toBeGreaterThan(originMaxY);
  });

  it("models every hybrid index handoff for branch-specific result tinting", () => {
    const origin = ingestionTrace();
    origin.definition.nodes[1].config = { backend: "pgvector", index_name: "dense" };
    origin.definition.nodes.push({
      id: LEXICAL_INDEX_ID,
      type: BM25_INDEXER_TYPE,
      name: "Lexical indexer",
      config: { backend: "pgvector", index_name: "lexical" },
    });
    origin.definition.edges.push({
      id: "lexical-write",
      source: "parse",
      target: LEXICAL_INDEX_ID,
    });
    origin.node_runs.push(
      makeNodeRunTrace({
        id: "r5",
        run_id: INGEST_RUN,
        node_id: LEXICAL_INDEX_ID,
        sequence_index: 2,
      }),
    );

    const retrieval = retrievalTrace();
    retrieval.definition.nodes[0].config = { backend: "pgvector", index_name: "dense" };
    retrieval.definition.nodes.push({
      id: LEXICAL_RETRIEVER_ID,
      type: BM25_RETRIEVER_TYPE,
      name: "Lexical retriever",
      config: { backend: "pgvector", index_name: "lexical" },
    });
    retrieval.definition.edges.push({
      id: "lexical-result",
      source: LEXICAL_RETRIEVER_ID,
      target: "out",
    });
    retrieval.node_runs.push(
      makeNodeRunTrace({ id: "r6", node_id: LEXICAL_RETRIEVER_ID, sequence_index: 2 }),
    );

    const graph = buildTraceGraph(retrieval, origin, nodeSpecs);
    const stores = graph.nodes.filter((node) => node.type === "indexStore");
    const lexicalWrite = graph.edges.find((edge) => edge.source === "origin::lexical-index");
    const lexicalRead = graph.edges.find((edge) => edge.target === "retrieval::lexical-retrieve");

    expect(stores).toHaveLength(2);
    expect(lexicalWrite?.target).toBe(lexicalRead?.source);
  });

  it("resolves each step's run and stage label", () => {
    const graph = buildTraceGraph(retrievalTrace(), ingestionTrace(), nodeSpecs);
    const first = graph.steps[0];
    expect(first.run?.node_id).toBe("parse");
    expect(first.stageLabel).toBe("Ingestion · origin");
    expect(graph.steps.at(-1)?.stageLabel).toBe("Retrieval");
  });

  it("keeps recorded execution order instead of inferring topology", () => {
    const trace = retrievalTrace();
    trace.node_runs = [
      makeNodeRunTrace({ id: "r3", node_id: "retrieve", sequence_index: 1 }),
      makeNodeRunTrace({ id: "r4", node_id: "out", sequence_index: 0 }),
    ];

    const graph = buildTraceGraph(trace, null, nodeSpecs);

    expect(graph.steps.map((step) => step.nodeId)).toEqual(["out", "retrieve"]);
  });
});
