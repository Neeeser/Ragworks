/**
 * Facet inference over a pipeline graph — the mirror of
 * `app/pipelines/facets.py`, used for live editor feedback (connection
 * validation, handle highlighting, edge/port coloring).
 *
 * Facets are per-item guarantees carried by `items` streams (`file`,
 * `text`, `image`, `embedding`, `score`). A port's effective guarantees depend on everything
 * upstream — a preserving node forwards whatever its input guaranteed — so
 * facet compatibility is a graph property, not a pairwise port check.
 * `preserves` reads the intersection of all the node's items inputs (see the
 * scope note on `NodePort` in `app/pipelines/ports.py`). The
 * shared vectors in `tests/assets/facet_vectors.json` pin this
 * implementation and the backend's together; a semantics change lands in
 * both plus the vectors, never one side.
 */

export const ITEMS_KIND = "items";

export type FacetPort = {
  key: string;
  data_type: string;
  requires?: readonly string[];
  accepts?: readonly string[];
  unaccepted?: "passthrough" | "exclude";
  adds?: readonly string[];
  preserves?: boolean;
};

/** Both bounds on what an items output port carries. */
export type InferredFacets = {
  /** What every item has — what the `requires` check reads. */
  guarantees: Map<string, Set<string>>;
  /** What any item might have — what modality analysis reads. */
  potentials: Map<string, Set<string>>;
};

/** The facets that describe what an item *is*, as opposed to derived ones. */
export const CONTENT_MODALITIES: ReadonlySet<string> = new Set(["file", "text", "image"]);

export type FacetNodePorts = ReadonlyMap<
  string,
  { inputs: readonly FacetPort[]; outputs: readonly FacetPort[] }
>;

export type FacetEdge = {
  id: string;
  source: string;
  sourcePort: string | null | undefined;
  target: string;
  targetPort: string | null | undefined;
};

export type FacetIssue = {
  edgeId: string;
  target: string;
  targetPort: string;
  missing: string[];
};

const resolvePort = (
  ports: readonly FacetPort[],
  key: string | null | undefined,
): FacetPort | undefined => {
  if (key === null || key === undefined) {
    return ports.length === 1 ? ports[0] : undefined;
  }
  return ports.find((port) => port.key === key);
};

const intersect = (sets: ReadonlySet<string>[]): Set<string> => {
  const [first, ...rest] = sets;
  const result = new Set(first);
  for (const other of rest) {
    for (const value of result) {
      if (!other.has(value)) result.delete(value);
    }
  }
  return result;
};

/** Return guaranteed facets per `"nodeId.portKey"` output port. */
export function inferOutputFacets(
  nodePorts: FacetNodePorts,
  edges: readonly FacetEdge[],
): Map<string, Set<string>> {
  return inferPortFacets(nodePorts, edges).guarantees;
}

/**
 * Infer both bounds on what every items output port carries.
 *
 * Guarantees are the lower bound (every item carries these) and potentials
 * the upper bound (any item might). Both propagate in topological order: a
 * preserving output carries the intersection of arriving guarantees — union,
 * for potentials — plus its own `adds`. A node's `adds` counts toward
 * guarantees only when nothing arriving can bypass it, since an item the
 * node does not accept leaves untouched. Nodes on a cycle and edges naming
 * unknown nodes/ports are skipped — inference never throws on a malformed
 * graph, it just leaves those ports unresolved.
 */
export function inferPortFacets(
  nodePorts: FacetNodePorts,
  edges: readonly FacetEdge[],
): InferredFacets {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, FacetEdge[]>();
  const incoming = new Map<string, FacetEdge[]>();
  for (const nodeId of nodePorts.keys()) {
    indegree.set(nodeId, 0);
    outgoing.set(nodeId, []);
    incoming.set(nodeId, []);
  }
  for (const edge of edges) {
    if (!nodePorts.has(edge.source) || !nodePorts.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const guarantees = new Map<string, Set<string>>();
  const potentials = new Map<string, Set<string>>();
  const ready = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  while (ready.length > 0) {
    const nodeId = ready.pop() as string;
    const decl = nodePorts.get(nodeId);
    if (!decl) continue;
    const inbound = incoming.get(nodeId) ?? [];
    const arriving = arrivingFacets(decl.inputs, inbound, nodePorts, guarantees);
    const arrivingPotential = arrivingUnion(decl.inputs, inbound, nodePorts, potentials);
    for (const port of decl.outputs) {
      if (port.data_type !== ITEMS_KIND) continue;
      guarantees.set(
        `${nodeId}.${port.key}`,
        outputGuarantees(port, decl.inputs, arriving, arrivingPotential),
      );
      potentials.set(
        `${nodeId}.${port.key}`,
        outputPotential(port, decl.inputs, arrivingPotential),
      );
    }
    for (const edge of outgoing.get(nodeId) ?? []) {
      const remaining = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, remaining);
      if (remaining === 0) ready.push(edge.target);
    }
  }
  return { guarantees, potentials };
}

const restrictedPassthrough = (inputs: readonly FacetPort[]): FacetPort[] =>
  inputs.filter(
    (port) =>
      port.data_type === ITEMS_KIND &&
      (port.accepts?.length ?? 0) > 0 &&
      (port.unaccepted ?? "passthrough") === "passthrough",
  );

/**
 * True when no arriving item can bypass this node's processing.
 *
 * Either the arriving guarantee shares a facet with `accepts` (so every item
 * carries one), or every facet that can appear at all is accepted — which a
 * mixed stream of chunks and images into a model reading both needs, since
 * neither facet is on every item there.
 */
const addsReachEverything = (
  inputs: readonly FacetPort[],
  arriving: ReadonlySet<string> | null,
  arrivingPotential: ReadonlySet<string>,
): boolean => {
  const restricted = restrictedPassthrough(inputs);
  if (restricted.length === 0 || arriving === null) return true;
  return restricted.every((port) => {
    const accepts = new Set(port.accepts ?? []);
    if ([...arriving].some((facet) => accepts.has(facet))) return true;
    return (
      arrivingPotential.size > 0 && [...arrivingPotential].every((facet) => accepts.has(facet))
    );
  });
};

const outputGuarantees = (
  port: FacetPort,
  inputs: readonly FacetPort[],
  arriving: ReadonlySet<string> | null,
  arrivingPotential: ReadonlySet<string>,
): Set<string> => {
  const guarantees = addsReachEverything(inputs, arriving, arrivingPotential)
    ? new Set(port.adds ?? [])
    : new Set<string>();
  if (port.preserves && arriving !== null) {
    for (const facet of arriving) guarantees.add(facet);
  }
  return guarantees;
};

/**
 * Potential for one output port: adds, plus whatever can flow through. A
 * preserving output forwards its input's potential; so does a non-preserving
 * one whose node lets unaccepted items pass, since those items are the input
 * stream leaving unchanged on the same port.
 *
 * An exclude port's preserving output forwards the full arriving potential
 * too, deliberately: facets co-occur on one item (a described image carries
 * text and image), so a facet outside `accepts` can ride out on an item
 * accepted for another facet. Pinned by the shared vector "a described image
 * passes a text sink and still reaches an image-accepting node".
 */
const outputPotential = (
  port: FacetPort,
  inputs: readonly FacetPort[],
  arrivingPotential: ReadonlySet<string>,
): Set<string> => {
  const potential = new Set(port.adds ?? []);
  if (port.preserves || restrictedPassthrough(inputs).length > 0) {
    for (const facet of arrivingPotential) potential.add(facet);
  }
  return potential;
};

const inboundSets = (
  inputs: readonly FacetPort[],
  inbound: readonly FacetEdge[],
  nodePorts: FacetNodePorts,
  resolved: ReadonlyMap<string, Set<string>>,
): Set<string>[] => {
  const sets: Set<string>[] = [];
  for (const edge of inbound) {
    const targetPort = resolvePort(inputs, edge.targetPort);
    if (!targetPort || targetPort.data_type !== ITEMS_KIND) continue;
    const sourceDecl = nodePorts.get(edge.source);
    const sourcePort = sourceDecl ? resolvePort(sourceDecl.outputs, edge.sourcePort) : undefined;
    if (!sourcePort || sourcePort.data_type !== ITEMS_KIND) {
      sets.push(new Set());
      continue;
    }
    sets.push(resolved.get(`${edge.source}.${sourcePort.key}`) ?? new Set());
  }
  return sets;
};

const arrivingFacets = (
  inputs: readonly FacetPort[],
  inbound: readonly FacetEdge[],
  nodePorts: FacetNodePorts,
  resolved: ReadonlyMap<string, Set<string>>,
): Set<string> | null => {
  const sets = inboundSets(inputs, inbound, nodePorts, resolved);
  if (sets.length === 0) return null;
  return intersect(sets);
};

/** Union what may arrive: a facet one branch might carry, this node might get. */
const arrivingUnion = (
  inputs: readonly FacetPort[],
  inbound: readonly FacetEdge[],
  nodePorts: FacetNodePorts,
  potentials: ReadonlyMap<string, Set<string>>,
): Set<string> => {
  const union = new Set<string>();
  for (const set of inboundSets(inputs, inbound, nodePorts, potentials)) {
    for (const facet of set) union.add(facet);
  }
  return union;
};

/** Return one issue per edge whose stream misses facets its target requires. */
export function facetIssues(nodePorts: FacetNodePorts, edges: readonly FacetEdge[]): FacetIssue[] {
  const resolved = inferOutputFacets(nodePorts, edges);
  const issues: FacetIssue[] = [];
  for (const edge of edges) {
    const sourceDecl = nodePorts.get(edge.source);
    const targetDecl = nodePorts.get(edge.target);
    if (!sourceDecl || !targetDecl) continue;
    const sourcePort = resolvePort(sourceDecl.outputs, edge.sourcePort);
    const targetPort = resolvePort(targetDecl.inputs, edge.targetPort);
    if (!sourcePort || !targetPort) continue;
    if (targetPort.data_type !== ITEMS_KIND || !targetPort.requires?.length) continue;
    const key = `${edge.source}.${sourcePort.key}`;
    const guarantees = resolved.get(key);
    if (!guarantees) continue; // unresolved source (cycle) — reported elsewhere
    const missing = [...targetPort.requires].filter((facet) => !guarantees.has(facet)).sort();
    if (missing.length > 0) {
      issues.push({ edgeId: edge.id, target: edge.target, targetPort: targetPort.key, missing });
    }
  }
  return issues;
}

/**
 * Display token for a port or stream: the kind for non-items planes, and a
 * facet-derived variant for items so handles/edges keep meaningful colors.
 */
export const facetsToken = (kind: string, facets: Iterable<string>): string => {
  if (kind !== ITEMS_KIND) return kind;
  const set = new Set(facets);
  if (set.has("embedding")) return "items_embedding";
  if (set.has("score")) return "items_scored";
  if (set.has("text")) return "items_text";
  if (set.has("image")) return "items_image";
  if (set.has("file")) return "items_file";
  return ITEMS_KIND;
};

/**
 * Static display token for a port declaration (no graph context).
 *
 * An input port reads from what it demands or processes — `accepts` when it
 * declares one, since a port that operates on images is an image port even
 * though it requires nothing of the stream.
 */
export const portToken = (port: FacetPort, side: "input" | "output"): string =>
  facetsToken(
    port.data_type,
    (side === "input" ? [...(port.requires ?? []), ...(port.accepts ?? [])] : port.adds) ?? [],
  );

/** Live wire-drag context: what the picked-up handle offers or asks for. */
export type ConnectingContext = {
  /** Port kind of the picked-up handle (`items`, `structured_values`, ...). */
  kind: string;
  /** Guarantees flowing from a picked-up source handle (graph-inferred). */
  facets: string[] | null;
  /** Facets a picked-up input handle requires. */
  requires: string[] | null;
  /** Which side was picked up: a source handle looks for targets, and vice versa. */
  from: "source" | "target";
  nodeId: string;
};

/**
 * Whether a candidate handle should light up while a wire is dragged.
 *
 * This is a hint, not the contract: for a preserving output whose guarantees
 * depend on how the rest of the graph is wired it stays permissive, and the
 * connect-time validation (with full inference) has the final word.
 */
export const connectionHintCompatible = (
  connecting: ConnectingContext,
  port: FacetPort,
  side: "input" | "output",
): boolean => {
  if (port.data_type !== connecting.kind) return false;
  if (connecting.from === "source" && side === "input") {
    if (port.data_type !== ITEMS_KIND) return true;
    const offered = new Set(connecting.facets ?? []);
    return (port.requires ?? []).every((facet) => offered.has(facet));
  }
  if (connecting.from === "target" && side === "output") {
    if (port.data_type !== ITEMS_KIND) return true;
    if (port.preserves) return true;
    const adds = new Set(port.adds ?? []);
    return (connecting.requires ?? []).every((facet) => adds.has(facet));
  }
  return false;
};
