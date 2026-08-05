/**
 * Live-editor modality findings: only what no model choice can cure.
 *
 * The full analysis is pinned against the backend by the shared vectors in
 * facet-inference.test.ts; these tests cover the twin-pass filter the sync
 * editor path uses, which the server (with catalog access) does not need.
 */
import { describe, expect, it } from "vitest";

import { stableModalityIssues } from "../modality";

import type { FacetEdge, FacetNodePorts, FacetPort } from "../facet-inference";

type NodeDecl = { inputs: FacetPort[]; outputs: FacetPort[] };

const imageSource: NodeDecl = {
  inputs: [],
  outputs: [{ key: "items", data_type: "items", adds: ["image"] }],
};

const bm25Sink = {
  inputs: [
    {
      key: "items",
      data_type: "items",
      accepts: ["text"],
      unaccepted: "exclude" as const,
    },
  ],
  outputs: [{ key: "items", data_type: "items", preserves: true }],
};

const embedder = {
  inputs: [{ key: "items", data_type: "items", accepts: ["text"] }],
  outputs: [
    { key: "items", data_type: "items", adds: ["embedding"], preserves: true },
  ],
};

const denseSink = {
  inputs: [
    {
      key: "items",
      data_type: "items",
      accepts: ["embedding"],
      unaccepted: "exclude" as const,
    },
  ],
  outputs: [{ key: "items", data_type: "items", preserves: true }],
};

const edge = (id: string, source: string, target: string): FacetEdge => ({
  id,
  source,
  sourcePort: "items",
  target,
  targetPort: "items",
});

describe("stableModalityIssues", () => {
  it("keeps a dead sink no model choice can cure", () => {
    // images -> bm25: no model anywhere widens anything, so the dead sink
    // is reported instantly.
    const nodePorts: FacetNodePorts = new Map([
      ["images", imageSource],
      ["bm25", bm25Sink],
    ]);
    const issues = stableModalityIssues(nodePorts, [edge("e1", "images", "bm25")], new Set());

    expect(issues.map((issue) => [issue.kind, issue.nodeId, issue.severity])).toContainEqual([
      "dead_node",
      "bm25",
      "error",
    ]);
  });

  it("suppresses a lost modality a multimodal embedding model would cure", () => {
    // images -> embed (floor: text) -> dense. With the embedder widened to
    // every modality the images reach the index, so the finding is left to
    // the server, which knows the actual model.
    const nodePorts: FacetNodePorts = new Map([
      ["images", imageSource],
      ["embed", embedder],
      ["dense", denseSink],
    ]);
    const edges = [edge("e1", "images", "embed"), edge("e2", "embed", "dense")];

    expect(stableModalityIssues(nodePorts, edges, new Set(["embed"]))).toEqual([]);
    // The same graph with a non-widening node keeps the finding.
    const kept = stableModalityIssues(nodePorts, edges, new Set());
    expect(kept.map((issue) => issue.kind)).toContain("lost_modality");
  });
});
