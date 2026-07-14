/** One playback wave. Every node in the wave is ready and runs concurrently. */
export type FlowStep = {
  nodeIds: string[];
};

type PlaybackNode = { id: string };
type PlaybackEdge = { id?: string; source: string; target: string };

export type PlaybackGraph = {
  nodes: readonly PlaybackNode[];
  edges: readonly PlaybackEdge[];
};

const edgeName = (edge: PlaybackEdge, index: number): string => edge.id ?? `edge-${index}`;

/**
 * Derive deterministic playback waves from a static DAG.
 *
 * Every wave contains all nodes whose connected predecessors completed in
 * earlier waves. This preserves parallel fan-out, waits for every connected
 * input at fan-in, and starts disconnected roots together. Optional inputs
 * without an edge impose no dependency. Node and edge serialization order do
 * not affect the result.
 *
 * Runtime traces must not use this inference: their recorded execution order
 * is authoritative and is adapted directly to FlowStep by the trace debugger.
 */
export function buildTopologyPlaybackSteps(graph: PlaybackGraph): FlowStep[] {
  const nodeIds = new Set<string>();
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Pipeline playback graph contains duplicate node id "${node.id}".`);
    }
    nodeIds.add(node.id);
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  graph.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.source)) {
      throw new Error(
        `Pipeline playback edge "${edgeName(edge, index)}" references missing source node "${edge.source}".`,
      );
    }
    if (!nodeIds.has(edge.target)) {
      throw new Error(
        `Pipeline playback edge "${edgeName(edge, index)}" references missing target node "${edge.target}".`,
      );
    }
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  });

  let ready = [...nodeIds].filter((nodeId) => indegree.get(nodeId) === 0).sort();
  const scheduled = new Set<string>();
  const steps: FlowStep[] = [];

  while (ready.length > 0) {
    steps.push({ nodeIds: ready });
    const nextReady: string[] = [];
    for (const nodeId of ready) {
      scheduled.add(nodeId);
      for (const target of outgoing.get(nodeId) ?? []) {
        const remaining = (indegree.get(target) ?? 0) - 1;
        indegree.set(target, remaining);
        if (remaining === 0) nextReady.push(target);
      }
    }
    ready = nextReady.sort();
  }

  if (scheduled.size !== nodeIds.size) {
    const cyclic = [...nodeIds].filter((nodeId) => !scheduled.has(nodeId)).sort();
    throw new Error(
      `Pipeline playback graph contains a cycle; cyclic or blocked nodes: ${cyclic.join(", ")}.`,
    );
  }

  return steps;
}
