/**
 * Cycles in the editor's graph, reported per edge.
 *
 * A pipeline runs in topological order, so a cycle makes it unrunnable — but
 * the server only says so on save, which is minutes of work after the wire was
 * drawn. Detecting it here lets the canvas mark the wires that form the loop
 * the moment one closes.
 *
 * Reported per *edge* rather than per node: a loop is something the user drew
 * and can cut, and the wires are what they cut. (`pipeline-playback.ts` also
 * detects cycles, node-level and by throwing, because scheduling a run needs a
 * topological order rather than a diagnosis.)
 */

export type CycleEdge = {
  id: string;
  source: string;
  target: string;
};

export type GraphCycles = {
  /** Ids of every edge lying on some cycle. */
  edgeIds: ReadonlySet<string>;
  /** One representative loop per cycle, as the node ids it passes through. */
  paths: readonly (readonly string[])[];
};

const EMPTY: GraphCycles = { edgeIds: new Set(), paths: [] };

/**
 * Strongly connected components, iteratively (Tarjan).
 *
 * Iterative because a pipeline graph is user-authored and a recursive walk
 * blows the stack on a long chain — a chain being the ordinary shape here.
 */
const stronglyConnected = (
  nodes: readonly string[],
  outgoing: ReadonlyMap<string, string[]>,
): string[][] => {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<{ node: string; edge: number }> = [{ node: root, edge: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbours = outgoing.get(frame.node) ?? [];
      if (frame.edge < neighbours.length) {
        const next = neighbours[frame.edge];
        frame.edge += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, edge: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        components.push(component);
      }
    }
  }
  return components;
};

/** One loop through a component, as node ids, starting and ending at `start`. */
const walkLoop = (
  start: string,
  member: ReadonlySet<string>,
  outgoing: ReadonlyMap<string, string[]>,
): string[] => {
  const seen = new Set<string>([start]);
  const path = [start];
  let current = start;
  for (;;) {
    const next = (outgoing.get(current) ?? []).find(
      (candidate) => member.has(candidate) && (candidate === start || !seen.has(candidate)),
    );
    if (next === undefined) return path;
    if (next === start) return [...path, start];
    seen.add(next);
    path.push(next);
    current = next;
  }
};

/**
 * Every edge lying on a cycle, plus one representative loop per cycle.
 *
 * An edge is on a cycle when both its ends sit in one strongly connected
 * component of more than one node, or when it is a self-loop. Marking whole
 * components rather than only the edge that closed the loop is deliberate: any
 * wire in the loop is a valid place to cut it, and highlighting one of them
 * points the user at an arbitrary choice.
 */
export const findGraphCycles = (edges: readonly CycleEdge[]): GraphCycles => {
  if (edges.length === 0) return EMPTY;

  const outgoing = new Map<string, string[]>();
  const nodes: string[] = [];
  const see = (node: string) => {
    if (!outgoing.has(node)) {
      outgoing.set(node, []);
      nodes.push(node);
    }
  };
  for (const edge of edges) {
    see(edge.source);
    see(edge.target);
    outgoing.get(edge.source)!.push(edge.target);
  }

  const cyclic = new Map<string, number>();
  const paths: string[][] = [];
  stronglyConnected(nodes, outgoing).forEach((component, group) => {
    const isSelfLoop =
      component.length === 1 && (outgoing.get(component[0]) ?? []).includes(component[0]);
    if (component.length < 2 && !isSelfLoop) return;
    const member = new Set(component);
    for (const node of component) cyclic.set(node, group);
    // `component` comes off the Tarjan stack in reverse discovery order; the
    // last entry is the component root, which is a stable starting point.
    paths.push(
      isSelfLoop
        ? [component[0], component[0]]
        : walkLoop(component[component.length - 1], member, outgoing),
    );
  });

  if (cyclic.size === 0) return EMPTY;
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    const group = cyclic.get(edge.source);
    if (group !== undefined && group === cyclic.get(edge.target)) edgeIds.add(edge.id);
  }
  return { edgeIds, paths };
};
