"use client";

import { useCallback, useState } from "react";

import { createPipeline } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { Pipeline, PipelineDefinition } from "@/lib/types";

export type WizardCreate = {
  creating: boolean;
  /** The current attempt's feedback, shown above the wizard footer. */
  message: string | null;
  setMessage: (message: string | null) => void;
  /** Clear the attempt channel — the wizard resets it whenever it reopens. */
  reset: () => void;
  create: (name: string, definition: PipelineDefinition) => Promise<void>;
};

/** The wizard's create action and the feedback channel for one attempt. */
export function useWizardCreate(
  token: string,
  onCreated: (pipeline: Pipeline) => void,
  onClose: () => void,
): WizardCreate {
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const create = useCallback(
    async (name: string, definition: PipelineDefinition) => {
      setCreating(true);
      setMessage(null);
      try {
        // No kind is sent: what the pipeline can do is derived from its graph.
        const created = await createPipeline(token, {
          name: name.trim(),
          definition,
          change_summary: "Initial pipeline scaffold.",
        });
        onCreated(created);
        onClose();
      } catch (error) {
        setMessage(getErrorMessage(error, "Unable to create pipeline."));
      } finally {
        setCreating(false);
      }
    },
    [token, onCreated, onClose],
  );

  const reset = useCallback(() => setMessage(null), []);

  return { creating, message, setMessage, reset, create };
}
