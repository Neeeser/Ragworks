import type { PipelineNodeData } from "../PipelineNode";
import type { PipelineValidationIssue } from "@/lib/types";

/** The node identity a blocker group needs — id plus what to call it. */
type BlockerNode = { id: string; data: Pick<PipelineNodeData, "label" | "nodeType"> };

/** Findings that stop a save, gathered under the node they belong to. */
export type SaveBlockerGroup = {
  /** The node the findings are about, or null for pipeline-level findings. */
  nodeId: string | null;
  /** What to call that node on screen — its editor label, else its type. */
  label: string;
  /** Client-side edge/config errors, which name no field. */
  errors: string[];
  /** Server findings of `error` severity, field-scoped or not. */
  issues: PipelineValidationIssue[];
};

type CollectSaveBlockersArgs = {
  nodes: BlockerNode[];
  /** Client-side errors by node id, as `useCanvasDecorations` derives them. */
  nodeErrors: Record<string, string[]>;
  /** The live-validation pass's findings; warnings never block a save. */
  issues: PipelineValidationIssue[];
};

const PIPELINE_LABEL = "Pipeline";

/**
 * Everything that would make this definition fail validation, attributed to a
 * node wherever the finding names one.
 *
 * A finding whose `node_id` matches no node on the canvas is kept under the
 * pipeline group rather than dropped: an issue rendered nowhere is the same
 * dead end as no feedback at all.
 */
export function collectSaveBlockers({
  nodes,
  nodeErrors,
  issues,
}: CollectSaveBlockersArgs): SaveBlockerGroup[] {
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const known = new Set(nodes.map((node) => node.id));

  const groups = nodes
    .map((node) => ({
      nodeId: node.id,
      label: node.data.label || node.data.nodeType,
      errors: nodeErrors[node.id] ?? [],
      issues: errorIssues.filter((issue) => issue.node_id === node.id),
    }))
    .filter((group) => group.errors.length > 0 || group.issues.length > 0);

  const pipelineIssues = errorIssues.filter((issue) => !issue.node_id || !known.has(issue.node_id));
  const orphanErrors = Object.entries(nodeErrors)
    .filter(([nodeId]) => !known.has(nodeId))
    .flatMap(([, errors]) => errors);

  if (pipelineIssues.length === 0 && orphanErrors.length === 0) return groups;
  return [
    ...groups,
    { nodeId: null, label: PIPELINE_LABEL, errors: orphanErrors, issues: pipelineIssues },
  ];
}
