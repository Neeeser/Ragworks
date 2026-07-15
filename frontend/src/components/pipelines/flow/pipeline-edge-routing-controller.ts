import type {
  BatchEdgeInput,
  BatchRoutingInput,
  BatchRoutingResults,
} from "@tisoap/react-flow-smart-edge";

export type RoutingSnapshot = {
  version: number;
  input: BatchRoutingInput;
  nodeSignature: string;
  edgeSignatures: ReadonlyMap<string, string>;
};

type DispatchSnapshot = (snapshot: RoutingSnapshot) => void;
type AppliedRoutes = { snapshot: RoutingSnapshot; results: BatchRoutingResults };

const edgeSignature = (edge: BatchEdgeInput) => JSON.stringify(edge);
const nodeSignature = (input: BatchRoutingInput) => JSON.stringify(input.nodes);

/**
 * Serializes routing work with one in-flight snapshot and one replaceable
 * pending slot. Results are published only for the latest exact geometry.
 */
export class LatestOnlyRoutingScheduler {
  private version = 0;
  private latest: RoutingSnapshot | null = null;
  private inFlight: RoutingSnapshot | null = null;
  private pending: RoutingSnapshot | null = null;
  private applied: AppliedRoutes | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly dispatch: DispatchSnapshot) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  submit(input: BatchRoutingInput): RoutingSnapshot {
    const snapshot = {
      version: (this.version += 1),
      input,
      nodeSignature: nodeSignature(input),
      edgeSignatures: new Map(input.edges.map((edge) => [edge.id, edgeSignature(edge)])),
    };
    // Deliberately keep `applied`: getMatchingResult signature-checks every
    // read, so still-valid routes keep rendering while this snapshot is in
    // flight. Dropping them here flashed every edge back to its smooth-step
    // fallback on each edge remount (e.g. per playback step transition).
    this.latest = snapshot;
    if (this.inFlight) {
      this.pending = snapshot;
    } else {
      this.start(snapshot);
    }
    this.emit();
    return snapshot;
  }

  complete(version: number, results: BatchRoutingResults) {
    if (this.inFlight?.version !== version) return;
    const finished = this.inFlight;
    this.inFlight = null;
    if (this.latest?.version === version) {
      this.applied = { snapshot: finished, results };
    }
    this.startPending();
    this.emit();
  }

  /** Retry the latest relevant snapshot after the caller switches transport. */
  fail(version: number) {
    if (this.inFlight?.version !== version) return;
    this.inFlight = null;
    this.applied = null;
    if (this.pending) {
      this.startPending();
    } else if (this.latest?.version === version) {
      this.start(this.latest);
    }
    this.emit();
  }

  cancel() {
    this.latest = null;
    this.inFlight = null;
    this.pending = null;
    this.applied = null;
    this.emit();
  }

  getResult(edgeId: string, version: number) {
    if (this.applied?.snapshot.version !== version) return null;
    return this.applied.results[edgeId] ?? null;
  }

  getMatchingResult(edgeId: string, nodes: string, edge: string) {
    const applied = this.applied;
    if (
      !applied ||
      applied.snapshot.nodeSignature !== nodes ||
      applied.snapshot.edgeSignatures.get(edgeId) !== edge
    ) {
      return null;
    }
    return applied.results[edgeId] ?? null;
  }

  private start(snapshot: RoutingSnapshot) {
    this.inFlight = snapshot;
    this.dispatch(snapshot);
  }

  private startPending() {
    if (!this.pending) return;
    const next = this.pending;
    this.pending = null;
    this.start(next);
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

export const makeEdgeSignature = edgeSignature;
export const makeNodeSignature = nodeSignature;
