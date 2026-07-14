import { routeSmartEdgesBatch } from "@tisoap/react-flow-smart-edge";
import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { PIPELINE_EDGE_ROUTING_OPTIONS } from "@/components/pipelines/flow/TypedEdge";
import {
  ESTIMATED_NODE_WIDTH,
  LAYER_GAP_X,
  layoutPipelineNodes,
  needsAutoLayout,
} from "@/components/pipelines/lib/pipeline-layout";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { Edge, Node } from "@xyflow/react";

type LayoutNode = Node<PipelineNodeData>;
type Fixture = { name: string; nodes: LayoutNode[]; edges: Edge[] };
type Rect = { left: number; right: number; top: number; bottom: number };
type Point = { x: number; y: number };
type NodeSize = { width: number; height: number };

const BASE_NODE_SIZE: NodeSize = { width: 264, height: 92 };
const FIRST_PORT_CENTER_Y = 74;
const PORT_ROW_HEIGHT = 20;

const makePort = (key: string) => ({
  key,
  label: key,
  data_type: "document",
  required: true,
  accepts_many: false,
});

const makeNode = (
  id: string,
  position = { x: 0, y: 0 },
  options: { data?: Partial<PipelineNodeData>; measured?: NodeSize } = {},
): LayoutNode => ({
  id,
  type: "pipelineNode",
  position,
  measured: options.measured ?? BASE_NODE_SIZE,
  data: {
    label: id,
    nodeType: "utility.passthrough",
    inputs: [makePort("input")],
    outputs: [makePort("output")],
    config: {},
    ...options.data,
  },
});

const edge = (source: string, target: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
  sourceHandle: "output",
  targetHandle: "input",
});

const signatureSchema = {
  type: "object",
  properties: {
    backend: { type: "string", default: "pgvector" },
    index_name: { type: "string", default: "documents" },
    namespace: { type: "string", default: "primary" },
  },
};

const makeSignatureNode = (id: string): LayoutNode =>
  makeNode(
    id,
    { x: 0, y: 0 },
    {
      data: {
        nodeType: "indexer.vector",
        configSchema: signatureSchema,
      },
      // Captured from the rendered index signature card. This is deliberately
      // independent of the layout estimator so geometry tests can catch drift.
      measured: { width: 264, height: 155 },
    },
  );

const fixture = (name: string, nodeIds: string[], pairs: Array<[string, string]>): Fixture => ({
  name,
  nodes: nodeIds.map((id) => makeNode(id)),
  edges: pairs.map(([source, target]) => edge(source, target)),
});

const HYBRID_NODE = {
  parser: "parser",
  chunker: "chunker",
  embedder: "embedder",
  semantic: "semantic-index",
  bm25: "bm25-index",
  output: "output",
} as const;

const SIGNATURE_NODE = {
  source: "signature-source",
  left: "signature-left",
  right: "signature-right",
  output: "signature-output",
} as const;

const fixtures: Fixture[] = [
  fixture(
    "linear pipeline",
    ["a", "b", "c"],
    [
      ["a", "b"],
      ["b", "c"],
    ],
  ),
  fixture(
    "fan-out",
    ["source", "left", "right"],
    [
      ["source", "left"],
      ["source", "right"],
    ],
  ),
  fixture(
    "fan-in",
    ["left", "right", "merge"],
    [
      ["left", "merge"],
      ["right", "merge"],
    ],
  ),
  fixture(
    "diamond",
    ["root", "left", "right", "merge"],
    [
      ["root", "left"],
      ["root", "right"],
      ["left", "merge"],
      ["right", "merge"],
    ],
  ),
  fixture(
    "unequal branch depths",
    ["root", "short", "long-1", "long-2", "merge"],
    [
      ["root", "short"],
      ["root", "long-1"],
      ["long-1", "long-2"],
      ["short", "merge"],
      ["long-2", "merge"],
    ],
  ),
  fixture(
    "nested branch and merge",
    ["root", "a", "b", "merge-1", "c", "d", "merge-2"],
    [
      ["root", "a"],
      ["root", "b"],
      ["a", "merge-1"],
      ["b", "merge-1"],
      ["merge-1", "c"],
      ["merge-1", "d"],
      ["c", "merge-2"],
      ["d", "merge-2"],
    ],
  ),
  fixture(
    "consecutive merges",
    ["root", "a", "b", "c", "merge-1", "merge-2"],
    [
      ["root", "a"],
      ["root", "b"],
      ["root", "c"],
      ["a", "merge-1"],
      ["b", "merge-1"],
      ["merge-1", "merge-2"],
      ["c", "merge-2"],
    ],
  ),
  fixture(
    "disconnected components",
    ["one-root", "two-root", "one-left", "two-next", "one-right", "one-merge"],
    [
      ["one-root", "one-left"],
      ["one-root", "one-right"],
      ["one-left", "one-merge"],
      ["one-right", "one-merge"],
      ["two-root", "two-next"],
    ],
  ),
  fixture(
    "shipped hybrid ingestion topology",
    [
      HYBRID_NODE.parser,
      HYBRID_NODE.chunker,
      HYBRID_NODE.embedder,
      HYBRID_NODE.semantic,
      HYBRID_NODE.bm25,
      HYBRID_NODE.output,
    ],
    [
      [HYBRID_NODE.parser, HYBRID_NODE.chunker],
      [HYBRID_NODE.chunker, HYBRID_NODE.embedder],
      [HYBRID_NODE.chunker, HYBRID_NODE.bm25],
      [HYBRID_NODE.embedder, HYBRID_NODE.semantic],
      [HYBRID_NODE.semantic, HYBRID_NODE.output],
      [HYBRID_NODE.bm25, HYBRID_NODE.output],
    ],
  ),
  {
    name: "rendered signature cards",
    nodes: [
      makeNode(SIGNATURE_NODE.source),
      makeSignatureNode(SIGNATURE_NODE.left),
      makeSignatureNode(SIGNATURE_NODE.right),
      makeNode(SIGNATURE_NODE.output),
    ],
    edges: [
      edge(SIGNATURE_NODE.source, SIGNATURE_NODE.left),
      edge(SIGNATURE_NODE.source, SIGNATURE_NODE.right),
      edge(SIGNATURE_NODE.left, SIGNATURE_NODE.output),
      edge(SIGNATURE_NODE.right, SIGNATURE_NODE.output),
    ],
  },
];

const measuredSize = (node: LayoutNode): NodeSize => {
  const { width, height } = node.measured ?? {};
  if (width === undefined || height === undefined) {
    throw new Error(`Fixture ${node.id} must declare independent measured dimensions.`);
  }
  return { width, height };
};

const nodeRect = (node: LayoutNode): Rect => ({
  left: node.position.x,
  right: node.position.x + measuredSize(node).width,
  top: node.position.y,
  bottom: node.position.y + measuredSize(node).height,
});

const rectsOverlap = (a: Rect, b: Rect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const bounds = (nodes: LayoutNode[]): Rect => {
  const rects = nodes.map(nodeRect);
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    right: Math.max(...rects.map((rect) => rect.right)),
    top: Math.min(...rects.map((rect) => rect.top)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  };
};

const segmentIntersectsRect = (start: Point, end: Point, rect: Rect) => {
  const epsilon = 0.01;
  const inner = {
    left: rect.left + epsilon,
    right: rect.right - epsilon,
    top: rect.top + epsilon,
    bottom: rect.bottom - epsilon,
  };
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let near = 0;
  let far = 1;
  const boundaries: Array<[number, number]> = [
    [-deltaX, start.x - inner.left],
    [deltaX, inner.right - start.x],
    [-deltaY, start.y - inner.top],
    [deltaY, inner.bottom - start.y],
  ];
  for (const [direction, distance] of boundaries) {
    if (direction === 0 && distance < 0) return false;
    if (direction === 0) continue;
    const ratio = distance / direction;
    if (direction < 0) near = Math.max(near, ratio);
    else far = Math.min(far, ratio);
    if (near > far) return false;
  }
  return true;
};

const assertNoNodeOverlap = (nodes: LayoutNode[]) => {
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      expect(
        rectsOverlap(nodeRect(nodes[first]), nodeRect(nodes[second])),
        `${nodes[first].id} overlaps ${nodes[second].id}`,
      ).toBe(false);
    }
  }
};

const portCenterY = (
  node: LayoutNode,
  handleId: string | null | undefined,
  side: "inputs" | "outputs",
) => {
  const index = Math.max(
    0,
    node.data[side].findIndex((port) => port.key === handleId),
  );
  return node.position.y + FIRST_PORT_CENTER_Y + index * PORT_ROW_HEIGHT;
};

const routePoints = (nodes: LayoutNode[], edges: Edge[]): Map<string, Point[]> => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const { preset = "smoothstep", ...options } = PIPELINE_EDGE_ROUTING_OPTIONS;
  const routingNodes: Node[] = nodes.map((node) => ({
    id: node.id,
    data: {},
    position: node.position,
    measured: measuredSize(node),
  }));
  const inputs = edges.map((connection) => {
    const source = nodesById.get(connection.source);
    const target = nodesById.get(connection.target);
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    return {
      id: connection.id,
      source: connection.source,
      target: connection.target,
      sourceX: source!.position.x + measuredSize(source!).width,
      sourceY: portCenterY(source!, connection.sourceHandle, "outputs"),
      targetX: target!.position.x,
      targetY: portCenterY(target!, connection.targetHandle, "inputs"),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      preset,
      options,
    };
  });
  const routed = routeSmartEdgesBatch({ nodes: routingNodes, edges: inputs });
  return new Map(
    inputs.map((input) => {
      const result = routed[input.id];
      expect(result, `No route returned for ${input.id}`).toBeDefined();
      const sourcePoint = { x: input.sourceX, y: input.sourceY };
      const targetPoint = { x: input.targetX, y: input.targetY };
      return [
        input.id,
        [sourcePoint, ...(result?.points ?? []).map(([x, y]) => ({ x, y })), targetPoint],
      ];
    }),
  );
};

const assertEdgesAvoidUnrelatedNodes = (nodes: LayoutNode[], edges: Edge[]) => {
  const routes = routePoints(nodes, edges);
  edges.forEach((connection) => {
    const points = routes.get(connection.id) ?? [];
    nodes
      .filter((node) => node.id !== connection.source && node.id !== connection.target)
      .forEach((node) => {
        for (let index = 1; index < points.length; index += 1) {
          expect(
            segmentIntersectsRect(points[index - 1], points[index], nodeRect(node)),
            `${connection.id} intersects unrelated node ${node.id}`,
          ).toBe(false);
        }
      });
  });
};

const centerY = (node: LayoutNode) => node.position.y + measuredSize(node).height / 2;

describe("layoutPipelineNodes", () => {
  it.each(fixtures)("keeps nodes and routed edges clear for $name", ({ nodes, edges }) => {
    const laid = layoutPipelineNodes(nodes, edges);

    assertNoNodeOverlap(laid);
    assertEdgesAvoidUnrelatedNodes(laid, edges);
  });

  it("lays a linear pipeline out as one straight left-to-right row", () => {
    const linear = fixtures[0];
    const laid = layoutPipelineNodes(linear.nodes, linear.edges);
    const columnWidth = ESTIMATED_NODE_WIDTH + LAYER_GAP_X;

    expect(laid.map((node) => node.position.x)).toEqual([0, columnWidth, columnWidth * 2]);
    expect(new Set(laid.map((node) => node.position.y)).size).toBe(1);
  });

  it("keeps a mixed-height straight run top-aligned so port rows line up", () => {
    // Cards have fixed-height headers with ports directly beneath, so a
    // straight run must share its top edge — center-aligning mixed heights
    // staggers the wires (and made the landing hero read as multi-row).
    const nodes = [
      makeNode("small", { x: 0, y: 0 }),
      makeNode("tall", { x: 0, y: 0 }, { measured: { width: 264, height: 155 } }),
      makeNode("small-again", { x: 0, y: 0 }),
    ];
    const edges = [edge("small", "tall"), edge("tall", "small-again")];

    const laid = layoutPipelineNodes(nodes, edges);

    expect(new Set(laid.map((node) => node.position.y)).size).toBe(1);
  });

  it("centers a fan-out source between its parallel branches", () => {
    const fanOut = fixtures[1];
    const byId = new Map(
      layoutPipelineNodes(fanOut.nodes, fanOut.edges).map((node) => [node.id, node]),
    );
    const branchMidpoint = (centerY(byId.get("left")!) + centerY(byId.get("right")!)) / 2;

    expect(centerY(byId.get("source")!)).toBe(branchMidpoint);
  });

  it("centers a fan-in merge between all of its inputs", () => {
    const fanIn = fixtures[2];
    const byId = new Map(
      layoutPipelineNodes(fanIn.nodes, fanIn.edges).map((node) => [node.id, node]),
    );
    const inputMidpoint = (centerY(byId.get("left")!) + centerY(byId.get("right")!)) / 2;

    expect(centerY(byId.get("merge")!)).toBe(inputMidpoint);
  });

  it("places the hybrid output between both index branches", () => {
    const hybrid = fixtures[8];
    const byId = new Map(
      layoutPipelineNodes(hybrid.nodes, hybrid.edges).map((node) => [node.id, node]),
    );
    const branchCenters = [
      centerY(byId.get(HYBRID_NODE.semantic)!),
      centerY(byId.get(HYBRID_NODE.bm25)!),
    ];
    const outputCenter = centerY(byId.get(HYBRID_NODE.output)!);

    expect(outputCenter).toBeGreaterThan(Math.min(...branchCenters));
    expect(outputCenter).toBeLessThan(Math.max(...branchCenters));
  });

  it("packs disconnected components into separate rectangles", () => {
    const disconnected = fixtures[7];
    const byId = new Map(
      layoutPipelineNodes(disconnected.nodes, disconnected.edges).map((node) => [node.id, node]),
    );
    const first = ["one-root", "one-left", "one-right", "one-merge"].map((id) => byId.get(id)!);
    const second = ["two-root", "two-next"].map((id) => byId.get(id)!);

    expect(rectsOverlap(bounds(first), bounds(second))).toBe(false);
  });

  it("returns identical positions when Tidy is repeated", () => {
    fixtures.forEach(({ nodes, edges }) => {
      const first = layoutPipelineNodes(nodes, edges);
      const second = layoutPipelineNodes(first, edges);

      expect(second.map(({ id, position }) => ({ id, position }))).toEqual(
        first.map(({ id, position }) => ({ id, position })),
      );
    });
  });

  it("keeps a representative larger DAG fast and within a bounded extent", () => {
    const layers = 16;
    const width = 5;
    const nodes = Array.from({ length: layers * width }, (_, index) => makeNode(`node-${index}`));
    const edges = Array.from({ length: (layers - 1) * width }, (_, index) => {
      const layer = Math.floor(index / width);
      const offset = index % width;
      return edge(
        `node-${layer * width + offset}`,
        `node-${(layer + 1) * width + ((offset + layer) % width)}`,
      );
    });
    const started = performance.now();
    const laid = layoutPipelineNodes(nodes, edges);
    const elapsed = performance.now() - started;
    const rects = laid.map(nodeRect);
    const routeStarted = performance.now();
    const routes = routePoints(laid, edges);
    const routeElapsed = performance.now() - routeStarted;

    expect(elapsed).toBeLessThan(250);
    // This exercises the package's synchronous no-Worker fallback under a
    // heavily parallel Vitest run. Browsers use the provider's Web Worker, so
    // the important regression guard is one bounded batch, never 75 renders.
    expect(routeElapsed).toBeLessThan(2_500);
    expect(routes.size).toBe(edges.length);
    expect(
      Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
    ).toBeLessThan(10_000);
    expect(
      Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top)),
    ).toBeLessThan(10_000);
    assertNoNodeOverlap(laid);
  });

  it("packs many isolated nodes into a bounded two-dimensional extent", () => {
    const nodes = Array.from({ length: 80 }, (_, index) => makeNode(`isolated-${index}`));
    const laid = layoutPipelineNodes(nodes, []);
    const graphBounds = bounds(laid);
    const width = graphBounds.right - graphBounds.left;
    const height = graphBounds.bottom - graphBounds.top;

    expect(width).toBeLessThan(5_000);
    expect(height).toBeLessThan(5_000);
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(3);
    assertNoNodeOverlap(laid);
  });

  it("keeps a mixed set of disconnected DAGs bounded and deterministic", () => {
    const nodes: LayoutNode[] = [];
    const edges: Edge[] = [];
    for (let component = 0; component < 20; component += 1) {
      const ids = [
        `component-${component}-a`,
        `component-${component}-b`,
        `component-${component}-c`,
      ];
      nodes.push(...ids.map((id) => makeNode(id)));
      edges.push(edge(ids[0], ids[1]), edge(ids[1], ids[2]));
    }
    nodes.push(...Array.from({ length: 20 }, (_, index) => makeNode(`loose-${index}`)));

    const first = layoutPipelineNodes(nodes, edges);
    const second = layoutPipelineNodes(first, edges);
    const graphBounds = bounds(first);
    const width = graphBounds.right - graphBounds.left;
    const height = graphBounds.bottom - graphBounds.top;

    expect(width).toBeLessThan(8_000);
    expect(height).toBeLessThan(8_000);
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(4);
    expect(second.map((node) => node.position)).toEqual(first.map((node) => node.position));
    assertNoNodeOverlap(first);
  });
});

describe("needsAutoLayout", () => {
  it("triggers when every node piles up at the origin", () => {
    expect(needsAutoLayout([makeNode("a"), makeNode("b")])).toBe(true);
  });

  it("triggers when saved positions overlap", () => {
    const nodes = [makeNode("a", { x: 0, y: 0 }), makeNode("b", { x: 140, y: 0 })];
    expect(needsAutoLayout(nodes)).toBe(true);
  });

  it("uses measured dimensions when detecting saved-position overlap", () => {
    const nodes = [
      makeNode("wide-a", { x: 0, y: 0 }, { measured: { width: 380, height: 155 } }),
      makeNode("wide-b", { x: 350, y: 0 }, { measured: { width: 380, height: 155 } }),
    ];

    expect(needsAutoLayout(nodes)).toBe(true);
  });

  it("keeps user-arranged positions that do not collide", () => {
    const nodes = [makeNode("a", { x: 0, y: 0 }), makeNode("b", { x: 400, y: 120 })];
    expect(needsAutoLayout(nodes)).toBe(false);
  });

  it("never relayouts a single node", () => {
    expect(needsAutoLayout([makeNode("a")])).toBe(false);
  });
});
