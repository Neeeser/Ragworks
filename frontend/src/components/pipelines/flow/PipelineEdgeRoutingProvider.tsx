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
type WorkerResponse = { version: number; results: ReturnType<typeof routeSmartEdgesBatch> };

const RoutingContext = createContext<RoutingContextValue | null>(null);

class RoutingRuntime {
  readonly scheduler: LatestOnlyRoutingScheduler;
  private active = true;
  private worker: Worker | null = null;
  private workerVersion: number | null = null;

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

  attachWorker(worker: Worker) {
    this.worker = worker;
  }

  receiveWorkerResult(response: WorkerResponse) {
    this.scheduler.complete(response.version, response.results);
  }

  failWorker(worker: Worker) {
    if (this.worker !== worker) return;
    const failedVersion = this.workerVersion;
    this.releaseWorker(worker);
    if (failedVersion !== null) this.scheduler.fail(failedVersion);
  }

  releaseWorker(worker: Worker) {
    worker.terminate();
    if (this.worker !== worker) return;
    this.worker = null;
    this.workerVersion = null;
  }

  private dispatch(snapshot: RoutingSnapshot) {
    queueMicrotask(() => {
      if (!this.active) return;
      const worker = this.worker;
      if (worker) {
        this.workerVersion = snapshot.version;
        try {
          worker.postMessage(snapshot);
          return;
        } catch {
          this.releaseWorker(worker);
        }
      }
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

/** Versioned, latest-only edge routing with a synchronous no-Worker fallback. */
export function PipelineEdgeRoutingProvider({
  nodes,
  children,
}: Readonly<{ nodes: PipelineNode[]; children: ReactNode }>) {
  const [runtime] = useState(() => new RoutingRuntime());
  const { scheduler } = runtime;
  const edgeInputsRef = useRef(new Map<string, BatchEdgeInput>());
  const routingNodesRef = useRef<Node[]>([]);
  const flushScheduledRef = useRef(false);
  const [geometry, setGeometry] = useState(() => makeGeometry(nodes));
  const nextSignature = geometrySignature(nodes);
  let currentGeometry = geometry;
  if (nextSignature !== geometry.signature) {
    currentGeometry = makeGeometry(nodes);
    setGeometry(currentGeometry);
  }

  const schedule = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    queueMicrotask(() => {
      flushScheduledRef.current = false;
      if (!runtime.isActive()) return;
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

  useEffect(() => {
    runtime.activate();
    return () => {
      runtime.deactivate();
    };
  }, [runtime]);

  useEffect(() => {
    if (typeof Worker === "undefined") return undefined;
    let worker: Worker;
    try {
      worker = new Worker(new URL("./pipeline-edge-routing.worker.ts", import.meta.url));
    } catch {
      return undefined;
    }
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      runtime.receiveWorkerResult(event.data);
    };
    worker.onerror = () => {
      runtime.failWorker(worker);
    };
    runtime.attachWorker(worker);
    return () => {
      runtime.releaseWorker(worker);
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
