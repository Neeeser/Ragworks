"use client";

import { useCallback, useMemo, useState } from "react";

import { diffDefinitions, materialChanges } from "../lib/pipeline-diff";
import { toPipelineDefinition } from "../lib/pipeline-utils";
import { collectSaveBlockers } from "../lib/save-blockers";

import { useTokenizerConsent } from "./use-tokenizer-consent";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PendingChange } from "../lib/pipeline-diff";
import type { SaveBlockerGroup } from "../lib/save-blockers";
import type { PipelineNodeData } from "../PipelineNode";
import type {
  Pipeline,
  PipelineDefinition,
  PipelineValidationIssue,
  PipelineVariable,
} from "@/lib/types";
import type { Node } from "@xyflow/react";

type UsePipelineSaveOptions = {
  token: string | null;
  selectedPipeline: Pipeline | null;
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  variables: PipelineVariable[];
  /** Client-side per-node errors, one half of what blocks a save. */
  nodeErrors: Record<string, string[]>;
  /** The debounced server pass, the other half. */
  validationIssues: PipelineValidationIssue[];
  setMessage: (message: string | null) => void;
  savePipeline: (definition: PipelineDefinition, fallbackSummary: string) => Promise<boolean>;
};

export type UsePipelineSaveResult = {
  /** Material changes against the saved revision — the "N unsaved" count. */
  pendingChanges: PendingChange[];
  dirty: boolean;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  /** What would fail this save, from both validators, attributed per node. */
  blockers: SaveBlockerGroup[];
  save: () => Promise<void>;
  tokenizerConsent: ReturnType<typeof useTokenizerConsent>;
};

/**
 * Everything about committing the canvas to a version: what changed, what
 * would block it, the dialog, and the tokenizer consent the save may need.
 *
 * Kept out of the builder because it is one state domain with one entry
 * point — the builder composes it and renders, and the save rules stay in
 * one place rather than spread across the orchestrator.
 */
export function usePipelineSave({
  token,
  selectedPipeline,
  nodes,
  edges,
  variables,
  nodeErrors,
  validationIssues,
  setMessage,
  savePipeline,
}: UsePipelineSaveOptions): UsePipelineSaveResult {
  const [dialogOpen, setDialogOpen] = useState(false);
  const tokenizerConsent = useTokenizerConsent(token, setMessage);

  const pendingChanges = useMemo(() => {
    if (!selectedPipeline) return [];
    return materialChanges(
      diffDefinitions(selectedPipeline.definition, toPipelineDefinition(nodes, edges, variables)),
    );
  }, [selectedPipeline, nodes, edges, variables]);

  // Gathered from both validators: the synchronous client checks and the
  // debounced server pass. The dialog opens on these rather than the button
  // refusing silently — the graph rules that reject a save (cycles,
  // unreachable nodes) live on the server, so a check that reads only the
  // client errors lets an invalid definition through to a save that then
  // fails, and one that reads neither leaves the user nothing to act on.
  const blockers = useMemo(
    () => collectSaveBlockers({ nodes, nodeErrors, issues: validationIssues }),
    [nodes, nodeErrors, validationIssues],
  );

  const openDialog = useCallback(() => {
    setMessage(null);
    setDialogOpen(true);
  }, [setMessage]);

  const save = useCallback(async () => {
    const fallbackSummary = pendingChanges
      .slice(0, 3)
      .map((change) => change.summary)
      .join("; ");
    const definition = toPipelineDefinition(nodes, edges, variables);
    await tokenizerConsent.ensureThen(definition, async () => {
      if (await savePipeline(definition, fallbackSummary)) setDialogOpen(false);
    });
  }, [pendingChanges, nodes, edges, variables, tokenizerConsent, savePipeline]);

  return {
    pendingChanges,
    dirty: pendingChanges.length > 0,
    dialogOpen,
    openDialog,
    closeDialog: useCallback(() => setDialogOpen(false), []),
    blockers,
    save,
    tokenizerConsent,
  };
}
