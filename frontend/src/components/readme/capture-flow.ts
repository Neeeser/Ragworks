import type { FlowStep } from "@/components/pipelines/flow/use-flow-playback";
import type { PipelineDefinition } from "@/lib/types";

/** Derive deterministic parallel playback stages from a pipeline DAG. */
export function buildPlaybackSteps(definition: PipelineDefinition): FlowStep[] {
  const predecessors = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of definition.edges) {
    predecessors.get(edge.target)?.push(edge.source);
  }

  const levels = new Map<string, number>();
  const remaining = new Set(definition.nodes.map((node) => node.id));
  while (remaining.size > 0) {
    const ready = definition.nodes.filter((node) => {
      const inputs = predecessors.get(node.id) ?? [];
      return remaining.has(node.id) && inputs.every((source) => levels.has(source));
    });
    if (ready.length === 0) {
      throw new Error("README capture pipelines must be acyclic.");
    }
    for (const node of ready) {
      const inputs = predecessors.get(node.id) ?? [];
      const level =
        inputs.length > 0 ? Math.max(...inputs.map((id) => levels.get(id) ?? 0)) + 1 : 0;
      levels.set(node.id, level);
      remaining.delete(node.id);
    }
  }

  const lastLevel = Math.max(-1, ...levels.values());
  return Array.from({ length: lastLevel + 1 }, (_, level) => ({
    nodeIds: definition.nodes
      .filter((node) => levels.get(node.id) === level)
      .map((node) => node.id),
  }));
}
