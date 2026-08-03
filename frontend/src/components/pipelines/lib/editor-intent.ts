/** The `?pipeline=&node=` deep link the prompt studio's "Used by" hands over. */

export type PipelineEditorIntent = {
  pipelineId: string;
  /** The node whose editor drawer should open, when the link names one. */
  nodeId: string | null;
};

/**
 * Read the link's target, or null when it names no pipeline.
 *
 * A deep link is a one-shot intent: the caller reads it once and spends it, so
 * whatever the user opens afterwards can never be overwritten by a re-read —
 * and it must beat the editor's own "first pipeline in the list" default,
 * which lands asynchronously once the catalog resolves.
 */
export function readEditorIntent(params: URLSearchParams | null): PipelineEditorIntent | null {
  const pipelineId = params?.get("pipeline");
  if (!pipelineId) return null;
  return { pipelineId, nodeId: params?.get("node") || null };
}
