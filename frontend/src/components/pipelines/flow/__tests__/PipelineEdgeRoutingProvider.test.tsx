import { act, render, screen } from "@testing-library/react";
import { Position } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineEdgeRoutingProvider, usePipelineEdgeRoute } from "../PipelineEdgeRoutingProvider";

import type { PipelineNodeData } from "../../PipelineNode";
import type { Node } from "@xyflow/react";

const syncRoute = vi.fn((input: unknown) => {
  void input;
  return {};
});
const ROUTE_TEST_ID = "route-edge-1";
const EDGE_2_TEST_ID = "route-edge-2";
const EDGE_1_ROUTE_AT_264 = "route:edge-1:264";
const EDGE_2_ROUTE_AT_264 = "route:edge-2:264";

vi.mock("@tisoap/react-flow-smart-edge", () => ({
  routeSmartEdgesBatch: (input: unknown) => syncRoute(input),
}));

/** Stub proving no Worker is ever constructed or messaged. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly messages: unknown[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {}
}

const makeNode = (id: string, x: number, y: number): Node<PipelineNodeData> => ({
  id,
  position: { x, y },
  measured: { width: 264, height: 92 },
  data: {
    label: id,
    nodeType: "utility.passthrough",
    inputs: [],
    outputs: [],
    config: {},
  },
});

const nodes = [makeNode("source", 0, 0), makeNode("target", 736, 0)];

type RoutingInput = {
  nodes: { id: string; position: { x: number; y: number } }[];
  edges: { id: string; sourceX: number; sourceY: number; targetY: number }[];
};

/** Routes every submitted edge to a path naming the edge and its sourceX. */
const routeAllEdges = (input: unknown) => {
  const { edges } = input as RoutingInput;
  return Object.fromEntries(
    edges.map((edge) => [
      edge.id,
      {
        svgPathString: `route:${edge.id}:${edge.sourceX}`,
        edgeCenterX: 500,
        edgeCenterY: 74,
        points: [],
      },
    ]),
  );
};

function RouteProbe({
  edgeId = "edge-1",
  source = "source",
  target = "target",
  sourceX,
  sourceY = 74,
  targetY = 74,
}: {
  edgeId?: string;
  source?: string;
  target?: string;
  sourceX: number;
  sourceY?: number;
  targetY?: number;
}) {
  const route = usePipelineEdgeRoute({
    id: edgeId,
    source,
    target,
    sourceX,
    sourceY,
    targetX: 736,
    targetY,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  });
  return <span data-testid={`route-${edgeId}`}>{route?.svgPathString ?? "fallback"}</span>;
}

const graph = (sourceX: number, routingNodes = nodes) => (
  <PipelineEdgeRoutingProvider nodes={routingNodes}>
    <RouteProbe sourceX={sourceX} />
  </PipelineEdgeRoutingProvider>
);

const flush = () => act(async () => Promise.resolve());

describe("PipelineEdgeRoutingProvider", () => {
  beforeEach(() => {
    syncRoute.mockClear();
    syncRoute.mockImplementation(routeAllEdges);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("applies only the newest of rapid endpoint snapshots", async () => {
    const { rerender } = render(graph(264));
    await flush();
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent(EDGE_1_ROUTE_AT_264);

    rerender(graph(274));
    rerender(graph(284));
    rerender(graph(294));
    // Until the pre-paint flush lands, a changed edge renders its native
    // fallback rather than a route computed for stale endpoints.
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");
    await flush();
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("route:edge-1:294");
  });

  it("keeps routes for multiple ports distinct within one batch", async () => {
    render(
      <PipelineEdgeRoutingProvider nodes={nodes}>
        <RouteProbe edgeId="edge-top" sourceX={264} sourceY={62} targetY={62} />
        <RouteProbe edgeId="edge-bottom" sourceX={264} sourceY={86} targetY={86} />
      </PipelineEdgeRoutingProvider>,
    );
    await flush();
    const submitted = syncRoute.mock.calls.at(-1)?.[0] as RoutingInput;
    expect(submitted.edges.map(({ id, sourceY, targetY }) => ({ id, sourceY, targetY }))).toEqual([
      { id: "edge-top", sourceY: 62, targetY: 62 },
      { id: "edge-bottom", sourceY: 86, targetY: 86 },
    ]);
    expect(screen.getByTestId("route-edge-top")).toHaveTextContent("route:edge-top:264");
    expect(screen.getByTestId("route-edge-bottom")).toHaveTextContent("route:edge-bottom:264");
  });

  it("clears a route immediately when obstacle geometry changes", async () => {
    const { rerender } = render(graph(264));
    await flush();
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent(EDGE_1_ROUTE_AT_264);

    const movedNodes = nodes.map((node) =>
      node.id === "source" ? { ...node, position: { x: 24, y: 0 } } : node,
    );
    rerender(graph(264, movedNodes));

    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");
    await flush();
    const submitted = syncRoute.mock.calls.at(-1)?.[0] as RoutingInput;
    expect(submitted.nodes[0].position.x).toBe(24);
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent(EDGE_1_ROUTE_AT_264);
  });

  it("keeps the native fallback when routing finds no path", async () => {
    syncRoute.mockImplementation(() => ({}));
    render(graph(264));
    await flush();
    expect(syncRoute).toHaveBeenCalled();
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");
  });

  it("computes no routes after unmount", async () => {
    const { rerender, unmount } = render(graph(264));
    await flush();
    syncRoute.mockClear();
    rerender(graph(274));
    unmount();
    await flush();
    expect(syncRoute).not.toHaveBeenCalled();
  });
});

describe("definitive edge layout", () => {
  // jsdom has no Worker, and the stubbed one must stay untouched: routing
  // resolves on the main thread in a pre-paint microtask, so a graph never
  // paints native fallbacks first and shifts to routes later.
  beforeEach(() => {
    syncRoute.mockClear();
    syncRoute.mockImplementation(routeAllEdges);
  });

  afterEach(() => vi.unstubAllGlobals());

  const fourNodes = [...nodes, makeNode("other-a", 0, 300), makeNode("other-b", 736, 300)];

  const twoEdgeGraph = (routingNodes: Node<PipelineNodeData>[], sourceX: number) => (
    <PipelineEdgeRoutingProvider nodes={routingNodes}>
      <RouteProbe edgeId="edge-1" sourceX={sourceX} />
      <RouteProbe
        edgeId="edge-2"
        source="other-a"
        target="other-b"
        sourceX={264}
        sourceY={374}
        targetY={374}
      />
    </PipelineEdgeRoutingProvider>
  );

  it("publishes initial routes from the main thread without a worker roundtrip", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.instances = [];
    render(graph(264));
    await flush();
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent(EDGE_1_ROUTE_AT_264);
    expect(FakeWorker.instances.flatMap((worker) => worker.messages)).toHaveLength(0);
  });

  it("keeps unmoved edges on their routed paths when a node drag begins", async () => {
    const { rerender } = render(twoEdgeGraph(fourNodes, 264));
    await flush();
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent(EDGE_1_ROUTE_AT_264);
    expect(screen.getByTestId(EDGE_2_TEST_ID)).toHaveTextContent(EDGE_2_ROUTE_AT_264);

    const draggedNodes = fourNodes.map((node) =>
      node.id === "source" ? { ...node, position: { x: 10, y: 0 }, dragging: true } : node,
    );
    rerender(twoEdgeGraph(draggedNodes, 274));
    await flush();

    // The dragged node's own edge follows the cursor on the native path; every
    // other edge keeps its exact routed path — no graph-wide flip at grab.
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");
    expect(screen.getByTestId(EDGE_2_TEST_ID)).toHaveTextContent(EDGE_2_ROUTE_AT_264);

    const droppedNodes = fourNodes.map((node) =>
      node.id === "source" ? { ...node, position: { x: 10, y: 0 }, dragging: false } : node,
    );
    rerender(twoEdgeGraph(droppedNodes, 274));
    await flush();
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("route:edge-1:274");
    expect(screen.getByTestId(EDGE_2_TEST_ID)).toHaveTextContent(EDGE_2_ROUTE_AT_264);
  });

  it("computes no routes while a drag is in progress and snaps once on drop", async () => {
    const { rerender } = render(twoEdgeGraph(fourNodes, 264));
    await flush();
    syncRoute.mockClear();

    for (const x of [8, 16, 24]) {
      const draggingNodes = fourNodes.map((node) =>
        node.id === "source" ? { ...node, position: { x, y: 0 }, dragging: true } : node,
      );
      rerender(twoEdgeGraph(draggingNodes, 264 + x));
      await flush();
    }
    expect(syncRoute).not.toHaveBeenCalled();

    const droppedNodes = fourNodes.map((node) =>
      node.id === "source" ? { ...node, position: { x: 24, y: 0 }, dragging: false } : node,
    );
    rerender(twoEdgeGraph(droppedNodes, 288));
    await flush();
    expect(syncRoute).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("route:edge-1:288");
  });
});
