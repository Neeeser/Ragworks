import { describe, expect, it } from "vitest";

import { collectSaveBlockers } from "../save-blockers";

import type { PipelineValidationIssue } from "@/lib/types";

const RETRIEVER_TYPE = "retriever.vector";
const RETRIEVER_LABEL = "Retriever";
const INDEX_REQUIRED = "An index is required.";

const node = (id: string, label: string, nodeType = RETRIEVER_TYPE) => ({
  id,
  data: { label, nodeType },
});

const issue = (overrides: Partial<PipelineValidationIssue>): PipelineValidationIssue => ({
  message: "Something is wrong.",
  severity: "error",
  ...overrides,
});

describe("collectSaveBlockers", () => {
  it("returns nothing when the graph has no errors", () => {
    expect(
      collectSaveBlockers({
        nodes: [node("a", RETRIEVER_LABEL)],
        nodeErrors: {},
        issues: [issue({ severity: "warning", node_id: "a" })],
      }),
    ).toEqual([]);
  });

  it("groups client errors and server errors under the node they name", () => {
    const fieldIssue = issue({
      node_id: "a",
      field: "chunk_size",
      message: "Chunk size exceeds the model input limit.",
    });

    expect(
      collectSaveBlockers({
        nodes: [node("a", RETRIEVER_LABEL), node("b", "Embedder", "embedder.text")],
        nodeErrors: { a: [INDEX_REQUIRED] },
        issues: [fieldIssue, issue({ severity: "warning", node_id: "b" })],
      }),
    ).toEqual([
      {
        nodeId: "a",
        label: RETRIEVER_LABEL,
        errors: [INDEX_REQUIRED],
        issues: [fieldIssue],
      },
    ]);
  });

  it("names a node by its type when it carries no label", () => {
    const [group] = collectSaveBlockers({
      nodes: [node("a", "", RETRIEVER_TYPE)],
      nodeErrors: { a: [INDEX_REQUIRED] },
      issues: [],
    });

    expect(group.label).toBe(RETRIEVER_TYPE);
  });

  it("keeps findings that name no node under a pipeline group", () => {
    const cycle = issue({ message: "The graph contains a cycle." });

    expect(
      collectSaveBlockers({ nodes: [node("a", RETRIEVER_LABEL)], nodeErrors: {}, issues: [cycle] }),
    ).toEqual([{ nodeId: null, label: "Pipeline", errors: [], issues: [cycle] }]);
  });

  it("keeps findings naming an unknown node rather than dropping them", () => {
    const stale = issue({ node_id: "gone", message: "Node is not connected." });

    expect(
      collectSaveBlockers({
        nodes: [node("a", RETRIEVER_LABEL)],
        nodeErrors: { gone: ["Stale client error."] },
        issues: [stale],
      }),
    ).toEqual([
      { nodeId: null, label: "Pipeline", errors: ["Stale client error."], issues: [stale] },
    ]);
  });
});
