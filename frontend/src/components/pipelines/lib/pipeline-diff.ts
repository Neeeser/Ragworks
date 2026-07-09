import type { PipelineDefinition, PipelineEdgeDefinition } from "@/lib/types";

/**
 * Client-side mirror of the backend's definition diff (`app/pipelines/diff.py`).
 * Powers the save panel's pending-change list and the "nothing to save" gate;
 * the backend recomputes the same diff authoritatively on save.
 */

export type PendingChangeKind =
  | "node_added"
  | "node_removed"
  | "node_renamed"
  | "node_config"
  | "edge_added"
  | "edge_removed"
  | "layout";

export type PendingChange = {
  kind: PendingChangeKind;
  summary: string;
};

const VALUE_PREVIEW_LIMIT = 40;

const formatValue = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof text !== "string") return String(value);
  return text.length > VALUE_PREVIEW_LIMIT ? `${text.slice(0, VALUE_PREVIEW_LIMIT - 1)}…` : text;
};

const edgeKey = (edge: PipelineEdgeDefinition) =>
  `${edge.source}|${edge.source_port ?? ""}|${edge.target}|${edge.target_port ?? ""}`;

const valuesEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const configChanges = (
  nodeName: string,
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>,
): PendingChange[] => {
  const keys = [...new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)])].sort();
  const changes: PendingChange[] = [];
  keys.forEach((key) => {
    const inOld = key in oldConfig;
    const inNew = key in newConfig;
    if (inOld && !inNew) {
      changes.push({ kind: "node_config", summary: `${nodeName}: cleared ${key}` });
    } else if (!inOld && inNew) {
      changes.push({
        kind: "node_config",
        summary: `${nodeName}: ${key} set to ${formatValue(newConfig[key])}`,
      });
    } else if (!valuesEqual(oldConfig[key], newConfig[key])) {
      changes.push({
        kind: "node_config",
        summary: `${nodeName}: ${key} ${formatValue(oldConfig[key])} → ${formatValue(newConfig[key])}`,
      });
    }
  });
  return changes;
};

export const diffDefinitions = (
  oldDefinition: PipelineDefinition,
  newDefinition: PipelineDefinition,
): PendingChange[] => {
  const changes: PendingChange[] = [];
  const oldNodes = new Map(oldDefinition.nodes.map((node) => [node.id, node]));
  const newNodes = new Map(newDefinition.nodes.map((node) => [node.id, node]));

  newNodes.forEach((node, id) => {
    if (!oldNodes.has(id)) {
      changes.push({ kind: "node_added", summary: `Added ${node.name}` });
    }
  });
  oldNodes.forEach((node, id) => {
    if (!newNodes.has(id)) {
      changes.push({ kind: "node_removed", summary: `Removed ${node.name}` });
    }
  });

  let layoutChanged = false;
  newNodes.forEach((node, id) => {
    const previous = oldNodes.get(id);
    if (!previous) return;
    if (previous.type !== node.type) {
      changes.push({
        kind: "node_config",
        summary: `${node.name}: type ${previous.type} → ${node.type}`,
      });
    }
    if (previous.name !== node.name) {
      changes.push({
        kind: "node_renamed",
        summary: `Renamed '${previous.name}' to '${node.name}'`,
      });
    }
    changes.push(...configChanges(node.name, previous.config ?? {}, node.config ?? {}));
    if (!valuesEqual(previous.position ?? null, node.position ?? null)) {
      layoutChanged = true;
    }
  });

  const label = (definition: PipelineDefinition, nodeId: string) =>
    definition.nodes.find((node) => node.id === nodeId)?.name ?? nodeId;
  const oldEdges = new Map(oldDefinition.edges.map((edge) => [edgeKey(edge), edge]));
  const newEdges = new Map(newDefinition.edges.map((edge) => [edgeKey(edge), edge]));
  newEdges.forEach((edge, key) => {
    if (!oldEdges.has(key)) {
      changes.push({
        kind: "edge_added",
        summary: `Connected ${label(newDefinition, edge.source)} → ${label(newDefinition, edge.target)}`,
      });
    }
  });
  oldEdges.forEach((edge, key) => {
    if (!newEdges.has(key)) {
      changes.push({
        kind: "edge_removed",
        summary: `Disconnected ${label(oldDefinition, edge.source)} → ${label(oldDefinition, edge.target)}`,
      });
    }
  });

  if (layoutChanged) {
    changes.push({ kind: "layout", summary: "Layout updated" });
  }
  return changes;
};

/** Changes that create a new revision when saved (everything but layout). */
export const materialChanges = (changes: PendingChange[]): PendingChange[] =>
  changes.filter((change) => change.kind !== "layout");
