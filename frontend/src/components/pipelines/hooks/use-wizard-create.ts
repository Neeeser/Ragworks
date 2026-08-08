"use client";

import { useCallback, useState } from "react";

import { createPipeline } from "@/lib/api";
import { getErrorMessage, getPipelineValidationFailure } from "@/lib/errors";

import type { Pipeline, PipelineDefinition, PipelineValidationErrorDetail } from "@/lib/types";

export type WizardCreate = {
  creating: boolean;
  /** The current attempt's feedback, shown above the wizard footer. */
  message: string | null;
  setMessage: (message: string | null) => void;
  /**
   * The findings behind a refused definition, when the server sent them.
   * Rendered as a per-node list beside the graph rather than folded into
   * `message`, where the whole payload collapses into one run-on string.
   */
  failure: PipelineValidationErrorDetail | null;
  /** Add a sentence to the current attempt's message, keeping what's there. */
  appendMessage: (text: string) => void;
  /** Clear the attempt channel — the wizard resets it whenever it reopens. */
  reset: () => void;
  /** True when the pipeline was created; false when the attempt was refused. */
  create: (name: string, definition: PipelineDefinition) => Promise<boolean>;
};

const REFUSED_MESSAGE = "This pipeline can't be created yet.";

/** The wizard's create action and the feedback channel for one attempt. */
export function useWizardCreate(
  token: string,
  onCreated: (pipeline: Pipeline) => void,
  onClose: () => void,
): WizardCreate {
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<PipelineValidationErrorDetail | null>(null);

  const create = useCallback(
    async (name: string, definition: PipelineDefinition): Promise<boolean> => {
      setCreating(true);
      setMessage(null);
      setFailure(null);
      try {
        // No kind is sent: what the pipeline can do is derived from its graph.
        const created = await createPipeline(token, {
          name: name.trim(),
          definition,
          change_summary: "Initial pipeline scaffold.",
        });
        onCreated(created);
        onClose();
        return true;
      } catch (error) {
        const refused = getPipelineValidationFailure(error);
        setFailure(refused ?? null);
        setMessage(
          refused ? REFUSED_MESSAGE : getErrorMessage(error, "Unable to create pipeline."),
        );
        return false;
      } finally {
        setCreating(false);
      }
    },
    [token, onCreated, onClose],
  );

  const appendMessage = useCallback(
    (text: string) => setMessage((prev) => (prev ? `${prev} ${text}` : text)),
    [],
  );

  const reset = useCallback(() => {
    setMessage(null);
    setFailure(null);
  }, []);

  return { creating, message, setMessage, appendMessage, failure, reset, create };
}
