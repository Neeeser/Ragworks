"use client";

import { createContext, useContext } from "react";

export type PipelineEditorHandle = {
  /**
   * Open a pipeline node in the editor already on screen. Returns false when
   * the pipeline is not one this editor lists (another kind, or deleted), so
   * the caller can fall back to navigating.
   */
  openNode: (pipelineId: string, nodeId: string) => boolean;
};

/**
 * The live pipeline editor, published so surfaces mounted *over* the canvas
 * can act on it in place.
 *
 * The prompt studio opens as an overlay precisely so tuning a node's prompt
 * costs the user neither their unsaved graph nor their place on the canvas —
 * a "used by" link inside it that navigated instead would throw both away.
 * Null outside the editor (the standalone Prompts page), where following the
 * link is the right answer.
 */
export const PipelineEditorContext = createContext<PipelineEditorHandle | null>(null);

export const usePipelineEditor = (): PipelineEditorHandle | null =>
  useContext(PipelineEditorContext);
