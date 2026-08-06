/**
 * Modality analysis over a pipeline graph — the mirror of
 * `app/pipelines/modality.py`, used for live editor findings.
 *
 * Two questions have unambiguous answers in any graph shape, and only those
 * two are asked: a node whose `accepts` cannot intersect anything reaching
 * it (dead), and a modality a node introduces that reaches no accepting
 * node (lost).
 * Everything between — a node taking part of a stream while another branch
 * handles the rest — is how typed dataflow with several branches normally
 * runs, so it is rendered as structure and never carries a severity.
 *
 * The shared vectors in `tests/assets/facet_vectors.json` pin this
 * implementation and the backend's together.
 */

import {
  CONTENT_MODALITIES,
  ITEMS_KIND,
  type FacetEdge,
  type FacetNodePorts,
  type FacetPort,
  inferPortFacets,
} from "./facet-inference";

export type ModalityIssue = {
  kind: "dead_node" | "lost_modality";
  nodeId: string;
  modality: string;
  portKey: string;
  severity: "error" | "warning";
  message: string;
};

const resolveInput = (
  inputs: readonly FacetPort[],
  key: string | null | undefined,
): FacetPort | undefined => {
  if (key === null || key === undefined) {
    return inputs.length === 1 ? inputs[0] : undefined;
  }
  return inputs.find((port) => port.key === key);
};

const isSinkPort = (port: FacetPort): boolean =>
  port.data_type === ITEMS_KIND && (port.accepts?.length ?? 0) > 0 && port.unaccepted === "exclude";

const message = (issue: Omit<ModalityIssue, "message">): string =>
  issue.kind === "dead_node"
    ? `Node '${issue.nodeId}' processes ${issue.modality} items, but no ${issue.modality} items can reach it.`
    : `${issue.modality.charAt(0).toUpperCase()}${issue.modality.slice(1)} items produced by node '${issue.nodeId}' reach no node that accepts them.`;

/** Return every dead-node and lost-modality finding in a graph. */
export function modalityIssues(
  nodePorts: FacetNodePorts,
  edges: readonly FacetEdge[],
): ModalityIssue[] {
  const { potentials } = inferPortFacets(nodePorts, edges);
  const outgoing = new Map<string, FacetEdge[]>();
  for (const nodeId of nodePorts.keys()) outgoing.set(nodeId, []);
  for (const edge of edges) {
    if (nodePorts.has(edge.source) && nodePorts.has(edge.target)) {
      outgoing.get(edge.source)?.push(edge);
    }
  }

  const issues = deadNodes(nodePorts, edges, potentials);
  const hasSink = [...nodePorts.values()].some((decl) => decl.inputs.some(isSinkPort));
  if (hasSink) issues.push(...lostModalities(nodePorts, outgoing, potentials));
  return issues;
}

/**
 * Findings no model choice can cure — the subset safe to show instantly.
 *
 * The server resolves each model's catalog and widens a `model_widens_accepts`
 * node's ports before it analyzes; this sync path cannot. Running the analysis
 * twice — declared ports, then those nodes widened to every content modality —
 * and keeping only findings present in both, reports exactly what stays wrong
 * whatever model the user picks. The rest arrives with the debounced server
 * validation instead of flashing a false warning until it does.
 */
export function stableModalityIssues(
  nodePorts: FacetNodePorts,
  edges: readonly FacetEdge[],
  widensByNode: ReadonlySet<string>,
): ModalityIssue[] {
  const declared = modalityIssues(nodePorts, edges);
  if (declared.length === 0 || widensByNode.size === 0) return declared;
  const widened: FacetNodePorts = new Map(
    [...nodePorts.entries()].map(([nodeId, decl]) => [
      nodeId,
      widensByNode.has(nodeId)
        ? {
            inputs: decl.inputs.map((port) =>
              port.data_type === ITEMS_KIND && (port.accepts?.length ?? 0) > 0
                ? { ...port, accepts: [...CONTENT_MODALITIES] }
                : port,
            ),
            outputs: decl.outputs,
          }
        : decl,
    ]),
  );
  // A dead-node finding's modality label is derived from `accepts`, which
  // widening rewrites — identity is the port, not the label. A lost-modality
  // finding is about one specific modality, so it keeps it in the key.
  const key = (issue: ModalityIssue): string =>
    issue.kind === "dead_node"
      ? `${issue.kind}:${issue.nodeId}:${issue.portKey}`
      : `${issue.kind}:${issue.nodeId}:${issue.portKey}:${issue.modality}`;
  const stable = new Set(modalityIssues(widened, edges).map(key));
  return declared.filter((issue) => stable.has(key(issue)));
}

const deadNodes = (
  nodePorts: FacetNodePorts,
  edges: readonly FacetEdge[],
  potentials: ReadonlyMap<string, Set<string>>,
): ModalityIssue[] => {
  const arriving = new Map<string, Set<string>>();
  for (const edge of edges) {
    const targetDecl = nodePorts.get(edge.target);
    const sourceDecl = nodePorts.get(edge.source);
    if (!targetDecl || !sourceDecl) continue;
    const port = resolveInput(targetDecl.inputs, edge.targetPort);
    if (!port || port.data_type !== ITEMS_KIND) continue;
    const sourcePort = resolveInput(sourceDecl.outputs, edge.sourcePort);
    if (!sourcePort) continue;
    const key = `${edge.target}.${port.key}`;
    const union = arriving.get(key) ?? new Set<string>();
    for (const facet of potentials.get(`${edge.source}.${sourcePort.key}`) ?? []) union.add(facet);
    arriving.set(key, union);
  }

  const issues: ModalityIssue[] = [];
  for (const [nodeId, decl] of nodePorts) {
    for (const port of decl.inputs) {
      if (port.data_type !== ITEMS_KIND || (port.accepts?.length ?? 0) === 0) continue;
      const inbound = arriving.get(`${nodeId}.${port.key}`);
      // Nothing wired in is a draft, not a dead node.
      if (!inbound || inbound.size === 0) continue;
      const accepts = new Set(port.accepts ?? []);
      if ([...inbound].some((facet) => accepts.has(facet))) continue;
      const issue = {
        kind: "dead_node" as const,
        nodeId,
        modality: [...accepts].sort().join(", "),
        portKey: port.key,
        severity: port.unaccepted === "exclude" ? ("error" as const) : ("warning" as const),
      };
      issues.push({ ...issue, message: message(issue) });
    }
  }
  return issues;
};

/** Facets an item can already carry when it leaves a producer. */
const DERIVED_AT_SOURCE = ["embedding", "score"];

const lostModalities = (
  nodePorts: FacetNodePorts,
  outgoing: ReadonlyMap<string, FacetEdge[]>,
  potentials: ReadonlyMap<string, Set<string>>,
): ModalityIssue[] => {
  const issues: ModalityIssue[] = [];
  for (const [nodeId, decl] of nodePorts) {
    for (const port of decl.outputs) {
      if (port.data_type !== ITEMS_KIND) continue;
      const produced = potentials.get(`${nodeId}.${port.key}`) ?? new Set<string>();
      const introduced = [...(port.adds ?? [])].filter((facet) => CONTENT_MODALITIES.has(facet));
      for (const modality of introduced.sort()) {
        const carried = new Set([
          modality,
          ...DERIVED_AT_SOURCE.filter((facet) => produced.has(facet)),
        ]);
        if (reachesSink(nodeId, port.key, carried, nodePorts, outgoing)) continue;
        const issue = {
          kind: "lost_modality" as const,
          nodeId,
          modality,
          portKey: port.key,
          severity: "warning" as const,
        };
        issues.push({ ...issue, message: message(issue) });
      }
    }
  }
  return issues;
};

/**
 * Walk one modality forward and report whether a node takes it.
 *
 * The walked set evolves: the `adds` of the preserving outputs an accepting
 * node forwards on join it, which is how an image item becomes embedded and
 * therefore acceptable to a dense indexer downstream. Only preserving
 * outputs continue the walk — a node emitting new items ends this item's
 * journey.
 *
 * Two acceptances end the walk successfully, and both mean a node took
 * responsibility for the item: an items input that *excludes* what it does
 * not accept (an indexer), and an accepting node with no preserving items
 * output, which consumes the item and emits something else in its place (a
 * parse node turning a file into text).
 */
const reachesSink = (
  nodeId: string,
  portKey: string,
  carried: ReadonlySet<string>,
  nodePorts: FacetNodePorts,
  outgoing: ReadonlyMap<string, FacetEdge[]>,
): boolean => {
  const seen = new Set<string>();
  const frontier: Array<[string, string, Set<string>]> = [[nodeId, portKey, new Set(carried)]];
  while (frontier.length > 0) {
    const [source, sourcePort, facets] = frontier.pop() as [string, string, Set<string>];
    const state = `${source}.${sourcePort}:${[...facets].sort().join(",")}`;
    if (seen.has(state)) continue;
    seen.add(state);
    for (const edge of outgoing.get(source) ?? []) {
      if (
        edge.sourcePort !== null &&
        edge.sourcePort !== undefined &&
        edge.sourcePort !== sourcePort
      )
        continue;
      const targetDecl = nodePorts.get(edge.target);
      if (!targetDecl) continue;
      const port = resolveInput(targetDecl.inputs, edge.targetPort);
      if (!port || port.data_type !== ITEMS_KIND) continue;
      const accepts = new Set(port.accepts ?? []);
      const accepted = accepts.size === 0 || [...facets].some((facet) => accepts.has(facet));
      if (port.unaccepted === "exclude") {
        if (accepted) return true; // an index took it
        continue; // excluded here; this path ends
      }
      const forwarding = targetDecl.outputs.filter(
        (out) => out.data_type === ITEMS_KIND && out.preserves,
      );
      // Consumed here, replaced by what the node emits.
      if (accepted && forwarding.length === 0) return true;
      for (const out of forwarding) {
        const forwarded = new Set(facets);
        if (accepted) for (const facet of out.adds ?? []) forwarded.add(facet);
        frontier.push([edge.target, out.key, forwarded]);
      }
    }
  }
  return false;
};
