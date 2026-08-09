import type { NodeDisplayStatus, PipelineNodeRunTrace } from "@/lib/types";

const summaryOutput = (run: PipelineNodeRunTrace, label: string): unknown =>
  run.summary?.outputs?.find((value) => value.label === label)?.value;

/**
 * A parse node that declined every file reaching it records `completed` —
 * passing through is its contract — but a green Done there reads as "the
 * file went through here". Its own summary tells the two apart: an
 * `Unread files` value with an empty `Parsed items` list means the node
 * read nothing, and that renders as `skipped`. A branch skip in a fan-out
 * renders the same way, which is what shows which branch carried the file.
 */
export const nodeDisplayStatus = (
  run: PipelineNodeRunTrace | null | undefined,
): NodeDisplayStatus | undefined => {
  if (!run) return undefined;
  if (run.status !== "completed") return run.status;
  if (summaryOutput(run, "Unread files") === undefined) return run.status;
  const parsed = summaryOutput(run, "Parsed items");
  const items =
    typeof parsed === "object" && parsed !== null && "items" in parsed
      ? (parsed as { items: unknown }).items
      : null;
  return Array.isArray(items) && items.length === 0 ? "skipped" : run.status;
};
