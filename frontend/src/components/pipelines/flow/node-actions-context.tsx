"use client";

import { createContext, useContext } from "react";

/**
 * What the selection toolbar on a node card can do. Supplied only by the
 * editor canvas — a node rendered by a trace view or a README scene finds no
 * provider and renders no toolbar, so read-only graphs stay read-only.
 */
export type PipelineNodeActions = {
  editNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
};

const PipelineNodeActionsContext = createContext<PipelineNodeActions | null>(null);

export const PipelineNodeActionsProvider = PipelineNodeActionsContext.Provider;

export const usePipelineNodeActions = () => useContext(PipelineNodeActionsContext);
