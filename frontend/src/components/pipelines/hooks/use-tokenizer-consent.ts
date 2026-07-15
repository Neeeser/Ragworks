"use client";

import { useCallback, useState } from "react";

import { huggingFaceTokenizerModelIds } from "@/components/pipelines/lib/tokenizer-consent";
import { ensureHuggingFaceTokenizer } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { getErrorMessage } from "@/lib/errors";

import type { PipelineDefinition } from "@/lib/types";

type ReadyAction = () => Promise<void>;
type PendingConsent = {
  ids: string[];
  index: number;
  ready: ReadyAction;
};

const isConsentRequired = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === 400 && /consent.*required/i.test(error.detail);

/** Coordinate cache checks and explicit consent before a pipeline mutation. */
export function useTokenizerConsent(
  token: string | null,
  setMessage: (message: string | null) => void,
) {
  const [pending, setPending] = useState<PendingConsent | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  const continueAt = useCallback(
    async (ids: string[], start: number, ready: ReadyAction) => {
      const authToken = token ?? "";
      if (!authToken) return;
      for (let index = start; index < ids.length; index += 1) {
        try {
          await ensureHuggingFaceTokenizer(authToken, { model_id: ids[index] });
        } catch (error) {
          if (isConsentRequired(error)) {
            setPending({ ids, index, ready });
            setModelId(ids[index]);
            setRemember(false);
            return;
          }
          setMessage(getErrorMessage(error, "Unable to prepare tokenizer."));
          return;
        }
      }
      await ready();
    },
    [setMessage, token],
  );

  const ensureThen = useCallback(
    async (definition: PipelineDefinition, ready: ReadyAction) => {
      setMessage(null);
      await continueAt(huggingFaceTokenizerModelIds(definition), 0, ready);
    },
    [continueAt, setMessage],
  );

  const confirm = useCallback(async () => {
    const authToken = token ?? "";
    if (!authToken || !pending || !modelId) return;
    setLoading(true);
    setMessage(null);
    try {
      await ensureHuggingFaceTokenizer(authToken, {
        model_id: modelId,
        consent: true,
        remember,
      });
      const next = pending;
      setPending(null);
      setModelId(null);
      await continueAt(next.ids, next.index + 1, next.ready);
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to download tokenizer."));
    } finally {
      setLoading(false);
    }
  }, [continueAt, modelId, pending, remember, setMessage, token]);

  const cancel = useCallback(() => {
    setPending(null);
    setModelId(null);
    setRemember(false);
  }, []);

  return {
    modelId,
    remember,
    setRemember,
    loading,
    ensureThen,
    confirm,
    cancel,
  };
}
