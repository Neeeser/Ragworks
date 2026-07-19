import { act, render, screen, waitFor } from "@testing-library/react";
import { Position } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineEdgeRoutingProvider, usePipelineEdgeRoute } from "../PipelineEdgeRoutingProvider";

import type { PipelineNodeData } from "../../PipelineNode";
import type { RoutingSnapshot } from "../pipeline-edge-routing-controller";
import type { BatchRoutingResults } from "@tisoap/react-flow-smart-edge";
import type { Node } from "@xyflow/react";

const syncRoute = vi.fn((input: unknown) => {
  void input;
  return {};
});
const ROUTE_TEST_ID = "route-edge-1";

vi.mock("@tisoap/react-flow-smart-edge", () => ({
  routeSmartEdgesBatch: (input: unknown) => syncRoute(input),
}));

class FakeWorker {
  static instances: FakeWorker[] = [];
  static throwOnPost = false;
  readonly messages: RoutingSnapshot[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(snapshot: RoutingSnapshot) {
    if (FakeWorker.throwOnPost) throw new DOMException("clone failed", "DataCloneError");
    this.messages.push(snapshot);
  }

  terminate() {
    this.terminated = true;
  }

  complete(index: number, path: string) {
    this.completeWithResults(index, {
      "edge-1": {
        svgPathString: path,
        edgeCenterX: 500,
        edgeCenterY: 74,
        points: [],
      },
    });
  }

  completeWithResults(index: number, results: BatchRoutingResults) {
    const snapshot = this.messages[index];
    this.onmessage?.({ data: { version: snapshot.version, results } } as MessageEvent);
  }
}

const nodes: Node<PipelineNodeData>[] = [
  {
    id: "source",
    position: { x: 0, y: 0 },
    measured: { width: 264, height: 92 },
    data: {
      label: "Source",
      nodeType: "utility.passthrough",
      inputs: [],
      outputs: [],
      config: {},
    },
  },
  {
    id: "target",
    position: { x: 736, y: 0 },
    measured: { width: 264, height: 92 },
    data: {
      label: "Target",
      nodeType: "utility.passthrough",
      inputs: [],
      outputs: [],
      config: {},
    },
  },
];

function RouteProbe({
  edgeId = "edge-1",
  sourceX,
  sourceY = 74,
  targetY = 74,
}: {
  edgeId?: string;
  sourceX: number;
  sourceY?: number;
  targetY?: number;
}) {
  const route = usePipelineEdgeRoute({
    id: edgeId,
    source: "source",
    target: "target",
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

describe("PipelineEdgeRoutingProvider", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.throwOnPost = false;
    syncRoute.mockClear();
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("falls back immediately and applies only the newest rapid endpoint snapshot", async () => {
    const { rerender } = render(graph(264));
    const worker = FakeWorker.instances[0];
    await waitFor(() => expect(worker.messages).toHaveLength(1));
    act(() => worker.complete(0, "seed"));
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("seed");

    rerender(graph(274));
    await waitFor(() => expect(worker.messages).toHaveLength(2));
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");
    rerender(graph(284));
    rerender(graph(294));
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");

    act(() => worker.complete(1, "stale-a"));
    await waitFor(() => expect(worker.messages).toHaveLength(3));
    expect(worker.messages.map((message) => message.input.edges[0]?.sourceX)).toEqual([
      264, 274, 294,
    ]);
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");

    act(() => worker.complete(1, "late-a"));
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");
    act(() => worker.complete(2, "current-c"));
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("current-c");
  });

  it("holds the native fallback while a node is dragging, even when a route matches", async () => {
    const draggingNodes = nodes.map((node) =>
      node.id === "source" ? { ...node, dragging: true } : node,
    );
    const { rerender } = render(graph(264, draggingNodes));
    const worker = FakeWorker.instances[0];
    await waitFor(() => expect(worker.messages).toHaveLength(1));

    // The worker completes a route that exactly matches current geometry, but a
    // drag is in progress: the edge must not flash to the routed path.
    act(() => worker.complete(0, "routed-mid-drag"));
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");

    // On drag stop the same geometry is no longer dragging: the route applies.
    rerender(graph(264, nodes));
    await waitFor(() =>
      expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("routed-mid-drag"),
    );
  });

  it("keeps routes for multiple ports distinct within one batch", async () => {
    render(
      <PipelineEdgeRoutingProvider nodes={nodes}>
        <RouteProbe edgeId="edge-top" sourceX={264} sourceY={62} targetY={62} />
        <RouteProbe edgeId="edge-bottom" sourceX={264} sourceY={86} targetY={86} />
      </PipelineEdgeRoutingProvider>,
    );
    const worker = FakeWorker.instances[0];
    await waitFor(() => expect(worker.messages).toHaveLength(1));
    expect(
      worker.messages[0].input.edges.map(({ id, sourceY, targetY }) => ({
        id,
        sourceY,
        targetY,
      })),
    ).toEqual([
      { id: "edge-top", sourceY: 62, targetY: 62 },
      { id: "edge-bottom", sourceY: 86, targetY: 86 },
    ]);

    act(() =>
      worker.completeWithResults(0, {
        "edge-top": {
          svgPathString: "top-path",
          edgeCenterX: 500,
          edgeCenterY: 62,
          points: [],
        },
        "edge-bottom": {
          svgPathString: "bottom-path",
          edgeCenterX: 500,
          edgeCenterY: 86,
          points: [],
        },
      }),
    );
    expect(screen.getByTestId("route-edge-top")).toHaveTextContent("top-path");
    expect(screen.getByTestId("route-edge-bottom")).toHaveTextContent("bottom-path");
  });

  it("clears a route immediately when obstacle geometry changes", async () => {
    const { rerender } = render(graph(264));
    const worker = FakeWorker.instances[0];
    await waitFor(() => expect(worker.messages).toHaveLength(1));
    act(() => worker.complete(0, "seed"));
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("seed");

    const movedNodes = nodes.map((node) =>
      node.id === "source" ? { ...node, position: { x: 24, y: 0 } } : node,
    );
    rerender(graph(264, movedNodes));

    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");
    await waitFor(() => expect(worker.messages).toHaveLength(2));
    expect(worker.messages[1].input.nodes[0].position.x).toBe(24);
    act(() => worker.complete(1, "moved"));
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("moved");
  });

  it("keeps the native fallback when the worker fails and sync routing finds no path", async () => {
    render(graph(264));
    const worker = FakeWorker.instances[0];
    await waitFor(() => expect(worker.messages).toHaveLength(1));

    act(() => worker.onerror?.());

    await waitFor(() => expect(syncRoute).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");
  });

  it("switches to the safe fallback when posting to the worker throws", async () => {
    FakeWorker.throwOnPost = true;

    render(graph(264));

    await waitFor(() => expect(syncRoute).toHaveBeenCalledTimes(1));
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(screen.getByTestId(ROUTE_TEST_ID)).toHaveTextContent("fallback");
  });

  it("terminates the worker and drops pending snapshots on unmount", async () => {
    const { rerender, unmount } = render(graph(264));
    const worker = FakeWorker.instances[0];
    await waitFor(() => expect(worker.messages).toHaveLength(1));
    rerender(graph(274));
    rerender(graph(284));
    unmount();

    expect(worker.terminated).toBe(true);
    act(() => worker.complete(0, "stale"));
    await act(async () => Promise.resolve());
    expect(worker.messages).toHaveLength(1);
  });
});
