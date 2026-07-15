import { describe, expect, it } from "vitest";

import {
  buildJourney,
  buildJourneyFocus,
  buildJourneySections,
} from "@/components/traces/lib/journey";
import { journeySentence } from "@/components/traces/lib/journey-sentences";
import { makeNodeRunTrace } from "@/test/fixtures";

import type { JourneyStep } from "@/components/traces/lib/journey";
import type { TraceGraph, TraceStage, TraceStep } from "@/components/traces/trace-graph";
import type { ItemListTrace, PipelineNodeSummaryValue } from "@/lib/types";

const FOCUSED_ID = "doc:1";
const ORIGIN_CHUNK_NODE = "origin::chunk";
const RETRIEVAL_DENSE_NODE = "retrieval::dense";
const CHUNK_ROLE = "chunks";
const MATCH_ROLE = "matches";
const CHUNK_ITEMS_LABEL = "Chunk items";
const MATCH_ITEMS_LABEL = "Match items";

const items = (
  label: string,
  kind: ItemListTrace["kind"],
  refs: Array<[string, number | null]>,
): PipelineNodeSummaryValue => ({
  label,
  kind: "items",
  value: {
    kind,
    items: refs.map(([id, score]) => ({ id, score })),
  },
});

const step = (
  nodeId: string,
  nodeName: string,
  inputs: PipelineNodeSummaryValue[],
  outputs: PipelineNodeSummaryValue[],
  stage: TraceStage = "retrieval",
): TraceStep => ({
  nodeIds: [nodeId],
  nodeId,
  run: makeNodeRunTrace({
    node_id: nodeId,
    node_name: nodeName,
    summary: { inputs, outputs },
  }),
  io: { inputs: [], outputs: [] },
  stage,
  stageLabel: stage === "origin" ? "Ingestion" : "Retrieval",
});

const graph = (steps: TraceStep[]): TraceGraph => ({
  nodes: [],
  edges: [],
  steps,
  combined: false,
});

const journeyStep = (overrides: Partial<JourneyStep>): JourneyStep => ({
  nodeId: "node",
  nodeName: "Node",
  stage: "retrieval",
  stageLabel: "Retrieval",
  role: MATCH_ROLE,
  rank: null,
  score: null,
  delta: null,
  effect: "passed",
  inputRank: null,
  inputCount: null,
  outputCount: null,
  inputListCount: 0,
  ...overrides,
});

describe("buildJourney", () => {
  it("derives created, passed, and dropped effects through a linear flow", () => {
    const trace = graph([
      step("chunk", "Chunker", [], [items(CHUNK_ITEMS_LABEL, CHUNK_ROLE, [[FOCUSED_ID, null]])]),
      step(
        "embed",
        "Embedder",
        [items(CHUNK_ITEMS_LABEL, CHUNK_ROLE, [[FOCUSED_ID, null]])],
        [items("Embedded items", CHUNK_ROLE, [[FOCUSED_ID, null]])],
      ),
      step(
        "filter",
        "Filter",
        [items("Input items", MATCH_ROLE, [[FOCUSED_ID, 0.8]])],
        [items("Output items", MATCH_ROLE, [])],
      ),
    ]);

    expect(buildJourney(trace, FOCUSED_ID)).toEqual([
      expect.objectContaining({
        nodeId: "chunk",
        nodeName: "Chunker",
        role: CHUNK_ROLE,
        rank: 1,
        score: null,
        delta: null,
        effect: "created",
        outputCount: 1,
      }),
      expect.objectContaining({
        nodeId: "embed",
        nodeName: "Embedder",
        role: CHUNK_ROLE,
        rank: 1,
        score: null,
        delta: 0,
        effect: "passed",
        inputRank: 1,
        inputCount: 1,
        outputCount: 1,
      }),
      expect.objectContaining({
        nodeId: "filter",
        nodeName: "Filter",
        role: MATCH_ROLE,
        rank: 1,
        score: 0.8,
        delta: null,
        effect: "dropped",
        inputRank: 1,
        inputCount: 1,
        outputCount: 0,
      }),
    ]);
  });

  it("distinguishes an introduced retrieval match from an absent branch", () => {
    const trace = graph([
      step(
        "dense",
        "Dense retriever",
        [],
        [items(MATCH_ITEMS_LABEL, MATCH_ROLE, [[FOCUSED_ID, 0.74]])],
      ),
      step("bm25", "BM25 retriever", [], [items(MATCH_ITEMS_LABEL, MATCH_ROLE, [])]),
    ]);

    expect(buildJourney(trace, FOCUSED_ID)).toEqual([
      expect.objectContaining({ nodeId: "dense", effect: "introduced", rank: 1, score: 0.74 }),
      expect.objectContaining({
        nodeId: "bm25",
        effect: "absent",
        rank: null,
        score: null,
        outputCount: 0,
      }),
    ]);
  });

  it("derives merge branch provenance and rerank improvement", () => {
    const trace = graph([
      step(
        "fusion",
        "RRF fusion",
        [
          items("Branch 1 items", MATCH_ROLE, []),
          items("Branch 2 items", MATCH_ROLE, [
            ["other", 0.6],
            [FOCUSED_ID, 0.5],
          ]),
        ],
        [items("Fused items", MATCH_ROLE, [[FOCUSED_ID, 0.82]])],
      ),
      step(
        "rerank",
        "Reranker",
        [
          items("Original items", MATCH_ROLE, [
            ["a", 0.9],
            ["b", 0.8],
            ["c", 0.7],
            [FOCUSED_ID, 0.6],
          ]),
        ],
        [
          items("Reranked items", MATCH_ROLE, [
            ["a", 0.95],
            [FOCUSED_ID, 0.91],
          ]),
        ],
      ),
    ]);

    expect(buildJourney(trace, FOCUSED_ID)).toEqual([
      expect.objectContaining({
        nodeId: "fusion",
        effect: "merged",
        rank: 1,
        score: 0.82,
        delta: 1,
        inputListCount: 2,
      }),
      expect.objectContaining({
        nodeId: "rerank",
        effect: "reordered",
        rank: 2,
        score: 0.91,
        delta: 2,
        inputRank: 4,
        inputCount: 4,
        outputCount: 2,
      }),
    ]);
  });

  it("keeps combined graph node prefixes intact", () => {
    const trace = graph([
      step(
        ORIGIN_CHUNK_NODE,
        "Chunker",
        [],
        [items(CHUNK_ITEMS_LABEL, CHUNK_ROLE, [[FOCUSED_ID, null]])],
        "origin",
      ),
      step(
        RETRIEVAL_DENSE_NODE,
        "Retriever",
        [],
        [items(MATCH_ITEMS_LABEL, MATCH_ROLE, [[FOCUSED_ID, 0.7]])],
      ),
    ]);

    expect(buildJourney(trace, FOCUSED_ID).map((entry) => entry.nodeId)).toEqual([
      ORIGIN_CHUNK_NODE,
      RETRIEVAL_DENSE_NODE,
    ]);
  });

  it("returns no journey without a focused id", () => {
    expect(buildJourney(graph([]), null)).toEqual([]);
  });
});

describe("buildJourneySections", () => {
  it("marks a stage with no item lists anywhere as unrecorded, not absent", () => {
    // A trace recorded before result tracing existed: retrieval nodes ran and
    // have summaries, but none attached item identity lists. That must never
    // read as the focused result being absent from retrieval.
    const trace = graph([
      step(
        ORIGIN_CHUNK_NODE,
        "Chunker",
        [],
        [items(CHUNK_ITEMS_LABEL, CHUNK_ROLE, [[FOCUSED_ID, null]])],
        "origin",
      ),
      step(
        RETRIEVAL_DENSE_NODE,
        "Retriever",
        [],
        [{ label: "Matches", kind: "json", value: [{ id: FOCUSED_ID }] }],
      ),
      step("retrieval::output", "Output", [], []),
    ]);

    const sections = buildJourneySections(trace, FOCUSED_ID);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ stage: "origin", recorded: true });
    expect(sections[0].steps.map((entry) => entry.effect)).toEqual(["created"]);
    expect(sections[1]).toMatchObject({ stage: "retrieval", recorded: false, steps: [] });
  });

  it("keeps a genuine miss as absent when siblings in the stage carry lists", () => {
    const trace = graph([
      step(
        "dense",
        "Dense retriever",
        [],
        [items(MATCH_ITEMS_LABEL, MATCH_ROLE, [[FOCUSED_ID, 0.7]])],
      ),
      step("bm25", "BM25 retriever", [], [items(MATCH_ITEMS_LABEL, MATCH_ROLE, [["other", 2.1]])]),
    ]);

    const sections = buildJourneySections(trace, FOCUSED_ID);
    expect(sections).toHaveLength(1);
    expect(sections[0].recorded).toBe(true);
    expect(sections[0].steps.map((entry) => entry.effect)).toEqual(["introduced", "absent"]);
  });
});

describe("journeySentence", () => {
  it("speaks chunk vocabulary for ingestion effects", () => {
    expect(
      journeySentence(
        journeyStep({ role: CHUNK_ROLE, effect: "created", rank: 5, outputCount: 74 }),
      ),
    ).toBe("Created as chunk 5 of 74");
    expect(
      journeySentence(journeyStep({ role: CHUNK_ROLE, effect: "passed", outputCount: 74 })),
    ).toBe("Carried through · 74 chunks");
    expect(
      journeySentence(
        journeyStep({ role: CHUNK_ROLE, effect: "introduced", rank: 75, outputCount: 76 }),
      ),
    ).toBe("Added here as chunk 75 of 76");
  });

  it("speaks retrieval vocabulary for match effects", () => {
    expect(
      journeySentence(journeyStep({ effect: "introduced", rank: 3, outputCount: 5, score: 8.999 })),
    ).toBe("Matched at rank 3 of 5 · score 8.999");
    expect(journeySentence(journeyStep({ effect: "absent", outputCount: 5 }))).toBe(
      "Not in this node's top 5",
    );
    expect(
      journeySentence(
        journeyStep({
          effect: "merged",
          rank: 3,
          inputListCount: 2,
          score: 0.032,
        }),
      ),
    ).toBe("Fused from 2 branches · entered at rank 3 · score 0.032");
    expect(journeySentence(journeyStep({ effect: "dropped", inputRank: 7, inputCount: 10 }))).toBe(
      "Dropped here · was rank 7 of 10 coming in",
    );
    expect(journeySentence(journeyStep({ effect: "passed", rank: 3, outputCount: 5 }))).toBe(
      "Delivered at rank 3 of 5",
    );
  });
});

describe("buildJourneyFocus", () => {
  it("tints traveled edges, includes the shared index handoff, and dims absent branches", () => {
    const trace: TraceGraph = {
      nodes: [
        {
          id: "a",
          type: "pipelineNode",
          position: { x: 0, y: 0 },
          data: { label: "A", nodeType: "indexer.vector", inputs: [], outputs: [], config: {} },
        },
        {
          id: "store",
          type: "indexStore",
          position: { x: 0, y: 0 },
          data: { label: "Store", nodeType: "store", inputs: [], outputs: [], config: {} },
        },
        {
          id: "b",
          type: "pipelineNode",
          position: { x: 0, y: 0 },
          data: { label: "B", nodeType: "retriever.vector", inputs: [], outputs: [], config: {} },
        },
        {
          id: "absent",
          type: "pipelineNode",
          position: { x: 0, y: 0 },
          data: { label: "Miss", nodeType: "retriever.bm25", inputs: [], outputs: [], config: {} },
        },
      ],
      edges: [
        { id: "write", type: "typed", source: "a", target: "store" },
        { id: "read", type: "typed", source: "store", target: "b" },
        { id: "miss", type: "typed", source: "absent", target: "b" },
      ],
      steps: [],
      combined: true,
    };
    const focus = buildJourneyFocus(trace, [
      journeyStep({ nodeId: "a", role: CHUNK_ROLE, rank: 1, delta: 0, effect: "passed" }),
      journeyStep({ nodeId: "b", rank: 2, score: 0.7, effect: "introduced" }),
      journeyStep({ nodeId: "absent", effect: "absent" }),
    ]);

    expect([...focus.traveledNodeIds]).toEqual(["a", "b"]);
    expect([...focus.absentNodeIds]).toEqual(["absent"]);
    expect([...focus.traveledEdgeIds]).toEqual(["write", "read"]);
    expect([...focus.absentEdgeIds]).toEqual(["miss"]);
    expect([...focus.storeNodeIds]).toEqual(["store"]);
  });
});
