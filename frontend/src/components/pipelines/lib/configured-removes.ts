/**
 * What a node destroys once its own config is read — the mirror of
 * `PipelineNodeBase.removes_for_node` (`app/pipelines/node.py`), which the
 * server resolves before it runs the same inference.
 *
 * An LLM shell writing an output field at an item's text rewrites the
 * content its embedding and score were computed from; one writing only
 * metadata leaves that content, and the annotations describing it, intact.
 * Without this the editor calls a graph sound that the server rejects on
 * save, which is the failure the client-side mirror exists to prevent.
 */

import type { FacetPort } from "./facet-inference";
import type { PipelineNodeData } from "../PipelineNode";
import type { Node } from "@xyflow/react";

/** Node types whose text writes are configured rather than declared. */
const TEXT_WRITING_SHELLS: ReadonlySet<string> = new Set(["llm.transform", "llm.describe"]);

/** What a text write destroys — matches `TEXT_WRITE_REMOVES` on the server. */
const TEXT_WRITE_REMOVES: readonly string[] = ["embedding", "score"];

const writesText = (config: Record<string, unknown>): boolean => {
  const fields = config.output_fields;
  if (!Array.isArray(fields)) return false;
  return fields.some((field) => {
    if (typeof field !== "object" || field === null) return false;
    const target = (field as { target?: unknown }).target;
    if (typeof target !== "object" || target === null) return false;
    return (target as { kind?: unknown }).kind === "text";
  });
};

/**
 * The node's output ports, with `removes` filled in where its config — not
 * its declaration — decides what it invalidates.
 */
export const withConfiguredRemoves = (node: Node<PipelineNodeData>): readonly FacetPort[] => {
  const outputs = node.data.outputs;
  if (!TEXT_WRITING_SHELLS.has(node.data.nodeType)) return outputs;
  if (!writesText(node.data.config ?? {})) return outputs;
  return outputs.map((port) =>
    port.key === "items" ? { ...port, removes: TEXT_WRITE_REMOVES } : port,
  );
};
