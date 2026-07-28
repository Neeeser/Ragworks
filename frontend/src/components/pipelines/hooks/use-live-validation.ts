"use client";

import { useEffect, useMemo } from "react";

import { validatePipeline } from "@/lib/api";

import { toPipelineDefinition } from "../lib/pipeline-utils";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type { PipelineDefinition, PipelineValidationIssue, PipelineVariable } from "@/lib/types";
import type { Node } from "@xyflow/react";

/** Quiet period after the last edit before asking the server to validate. */
const DEBOUNCE_MS = 400;

type LiveValidationOptions = {
  token: string | null;
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  variables: PipelineVariable[];
  /** The open drawer's uncommitted config, so the check sees what is on screen. */
  draft: { nodeId: string; config: Record<string, unknown> } | null;
  enabled: boolean;
  /** Must be referentially stable — a fresh function re-runs the request. */
  onIssues: (issues: PipelineValidationIssue[]) => void;
};

/**
 * Validate the definition being edited, shortly after typing stops.
 *
 * Server rules — embedding input limits, backend compatibility, expression
 * taint — were previously reachable only by saving, so a field could be wrong
 * for a whole session without saying so. Running them on a debounce puts every
 * one of them on the field while it is being edited.
 *
 * Responses are sequenced through the request payload: a slow reply for an
 * older definition is dropped rather than overwriting a newer one's issues.
 * Issues are replaced only on success and never cleared while a request is in
 * flight, so they do not flicker between keystrokes.
 */
export function useLiveValidation({
  token,
  nodes,
  edges,
  variables,
  draft,
  enabled,
  onIssues,
}: LiveValidationOptions): void {
  // Serialized so the effect re-runs on content, not on array identity —
  // ReactFlow hands back a fresh nodes array on every pointer move.
  const payload = useMemo(() => {
    if (!enabled || nodes.length === 0) return null;
    const merged = draft
      ? nodes.map((node) =>
          node.id === draft.nodeId
            ? { ...node, data: { ...node.data, config: draft.config } }
            : node,
        )
      : nodes;
    return JSON.stringify(toPipelineDefinition(merged, edges, variables));
  }, [enabled, nodes, edges, variables, draft]);

  useEffect(() => {
    if (!token || payload === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void validatePipeline(token, JSON.parse(payload) as PipelineDefinition)
        .then((result) => {
          // A newer edit already superseded this request.
          if (!cancelled) onIssues(result.issues);
        })
        .catch(() => {
          // A failed request says nothing about the definition — keep the last
          // known issues rather than implying the graph became clean.
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [payload, token, onIssues]);
}
