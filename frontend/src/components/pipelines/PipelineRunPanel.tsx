"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

import { useDraftRun } from "./hooks/use-draft-run";
import { RunPanelOverlay } from "./RunPanelOverlay";

import type { TypedEdgeType } from "./flow/TypedEdge";
import type { PipelineNodeData } from "./PipelineNode";
import type { Collection, NodeSpec, PipelineVariable } from "@/lib/types";
import type { Node } from "@xyflow/react";

export type PipelineRunPanelHandle = {
  open: () => void;
};

type PipelineRunPanelProps = {
  token: string | null;
  pipelineId: string | null;
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  variables: PipelineVariable[];
  collections: Collection[];
  nodeSpecs: NodeSpec[];
};

/**
 * The run panel and everything that belongs only to it: whether it is open,
 * and the draft run it holds.
 *
 * The sample query and the last run's trace survive closing the panel — the
 * query is the input being tuned against, so reopening to try one more edit
 * must not clear it. Callers only ask it to open, the way they ask for the
 * create-pipeline wizard.
 */
export const PipelineRunPanel = forwardRef<PipelineRunPanelHandle, PipelineRunPanelProps>(
  function PipelineRunPanel(
    { token, pipelineId, nodes, edges, variables, collections, nodeSpecs },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const draftRun = useDraftRun({ token, pipelineId, nodes, edges, variables, collections });

    useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);

    if (!open) return null;
    return <RunPanelOverlay run={draftRun} nodeSpecs={nodeSpecs} onClose={() => setOpen(false)} />;
  },
);
