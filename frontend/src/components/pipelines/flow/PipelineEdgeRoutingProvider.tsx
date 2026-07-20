"use client";

import { routeSmartEdgesBatch } from "@tisoap/react-flow-smart-edge";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { resolveNodeDimensions } from "../lib/pipeline-layout";

import {
  LatestOnlyRoutingScheduler,
  makeEdgeSignature,
  makeNodeSignature,
  type RoutingSnapshot,
} from "./pipeline-edge-routing-controller";

import type { PipelineNodeData } from "../PipelineNode";
import type {
  BatchEdgeInput,
  EdgeRouteInput,
  SmartEdgeBatchOptions,
} from "@tisoap/react-flow-smart-edge";
import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";

export const PIPELINE_EDGE_ROUTING_OPTIONS = {
  preset: "smoothstep",
  gridRatio: 10,
  nodePadding: 16,
  borderRadius: 6,
} satisfies SmartEdgeBatchOptions;

type PipelineNode = Node<PipelineNodeData>;
type RoutingContextValue = {
  scheduler: LatestOnlyRoutingScheduler;
  nodeSignature: string;
  registerEdge: (input: BatchEdgeInput) => () => void;
};

const RoutingContext = createContext<RoutingContextValue | null>(null);

/**
 * Computes routes synchronously in a pre-paint microtask. Routing only runs
 * on discrete geometry commits (mount, drop, tidy, node add/remove — drags
 * are frozen by the provider), so the graph never paints a frame where an
 * edge is waiting on an async route: results land before the browser paints.
 */
class RoutingRuntime {
  readonly scheduler: LatestOnlyRoutingScheduler;
  private active = true;

  constructor() {
    this.scheduler = new LatestOnlyRoutingScheduler((snapshot) => this.dispatch(snapshot));
  }

  activate() {
    this.active = true;
  }

  deactivate() {
    this.active = false;
    this.scheduler.cancel();
  }

  isActive() {
    return this.active;
  }

  private dispatch(snapshot: RoutingSnapshot) {
    queueMicrotask(() => {
      if (!this.active) return;
      let results: ReturnType<typeof routeSmartEdgesBatch> = {};
      try {
        results = routeSmartEdgesBatch(snapshot.input);
      } catch {
        // An empty result keeps native smooth-step fallbacks visible.
      }
      this.scheduler.complete(snapshot.version, results);
    });
  }
}

const geometrySignature = (nodes: PipelineNode[]) =>
  nodes
    .map((node) => {
      const { width, height } = resolveNodeDimensions(node);
      return [node.id, node.position.x, node.position.y, width, height, node.parentId ?? ""].join(
        ":",
      );
    })
    .join("|");

const makeGeometry = (nodes: PipelineNode[]) => ({
  signature: geometrySignature(nodes),
  nodes: nodes.map((node) => ({
    id: node.id,
    position: node.position,
    measured: resolveNodeDimensions(node),
    parentId: node.parentId,
    data: {},
  })),
});

/**
 * Versioned, latest-only edge routing, computed synchronously before paint.
 *
 * While a node drags, the routing geometry is frozen at its pre-drag state
 * and no new routes are computed: per-edge signature matching then keeps
 * every unmoved edge on its exact routed path, while edges whose own
 * endpoints move (the dragged node's wires) fall back to the native step
 * path that follows the cursor — one snap to the fresh route on drop, and
 * no graph-wide flip at grab.
 */
export function PipelineEdgeRoutingProvider({
  nodes,
  children,
}: Readonly<{ nodes: PipelineNode[]; children: ReactNode }>) {
  const [runtime] = useState(() => new RoutingRuntime());
  const { scheduler } = runtime;
  const edgeInputsRef = useRef(new Map<string, BatchEdgeInput>());
  const routingNodesRef = useRef<Node[]>([]);
  const flushScheduledRef = useRef(false);
  const dragging = nodes.some((node) => node.dragging);
  const draggingRef = useRef(dragging);
  // Effect (not render) assignment: children's registerEdge effects only queue
  // microtasks, which run after all commit effects — the ref is current by the
  // time any scheduled submission reads it.
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);
  const [geometry, setGeometry] = useState(() => makeGeometry(nodes));
  let currentGeometry = geometry;
  if (!dragging) {
    const nextSignature = geometrySignature(nodes);
    if (nextSignature !== geometry.signature) {
      currentGeometry = makeGeometry(nodes);
      setGeometry(currentGeometry);
    }
  }

  const schedule = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    queueMicrotask(() => {
      flushScheduledRef.current = false;
      if (!runtime.isActive() || draggingRef.current) return;
      scheduler.submit({
        nodes: routingNodesRef.current,
        edges: [...edgeInputsRef.current.values()],
      });
    });
  }, [runtime, scheduler]);

  const registerEdge = useCallback(
    (input: BatchEdgeInput) => {
      edgeInputsRef.current.set(input.id, input);
      schedule();
      return () => {
        edgeInputsRef.current.delete(input.id);
        schedule();
      };
    },
    [schedule],
  );

  useEffect(() => {
    routingNodesRef.current = currentGeometry.nodes;
    schedule();
  }, [currentGeometry.nodes, schedule]);

  // Submissions suppressed mid-drag (edges re-register every frame) are
  // flushed once on drop, even when the node lands back on its exact
  // pre-drag geometry and no geometry commit fires.
  useEffect(() => {
    if (!dragging) schedule();
  }, [dragging, schedule]);

  useEffect(() => {
    runtime.activate();
    return () => {
      runtime.deactivate();
    };
  }, [runtime]);

  const nodesKey = makeNodeSignature({ nodes: currentGeometry.nodes, edges: [] });
  const value = useMemo(
    () => ({ scheduler, nodeSignature: nodesKey, registerEdge }),
    [scheduler, nodesKey, registerEdge],
  );
  return <RoutingContext.Provider value={value}>{children}</RoutingContext.Provider>;
}

const makeEdgeInput = (edge: EdgeRouteInput): BatchEdgeInput => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  sourceX: edge.sourceX,
  sourceY: edge.sourceY,
  targetX: edge.targetX,
  targetY: edge.targetY,
  sourcePosition: edge.sourcePosition,
  targetPosition: edge.targetPosition,
  preset: PIPELINE_EDGE_ROUTING_OPTIONS.preset,
  options: {
    gridRatio: PIPELINE_EDGE_ROUTING_OPTIONS.gridRatio,
    nodePadding: PIPELINE_EDGE_ROUTING_OPTIONS.nodePadding,
    borderRadius: PIPELINE_EDGE_ROUTING_OPTIONS.borderRadius,
  },
});

/** Returns a route only when it matches the exact current nodes and endpoints. */
export const usePipelineEdgeRoute = (edge: EdgeRouteInput) => {
  const context = useContext(RoutingContext);
  const input = makeEdgeInput(edge);
  const signature = makeEdgeSignature(input);
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });
  const registerEdge = context?.registerEdge;
  useEffect(() => {
    if (!registerEdge) return undefined;
    return registerEdge(inputRef.current);
  }, [registerEdge, signature]);

  return useSyncExternalStore(
    context?.scheduler.subscribe ?? (() => () => undefined),
    () => context?.scheduler.getMatchingResult(edge.id, context.nodeSignature, signature) ?? null,
    () => null,
  );
};
