"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { outputFieldsFromConfig } from "@/components/pipelines/lib/llm";
import {
  createPrompt,
  deletePrompt,
  forkPrompt,
  getPrompt,
  listPromptCatalogs,
  listPrompts,
  listPromptVersions,
  renderPrompt,
  savePromptVersion,
  updatePrompt,
} from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";

import { isNodeContext } from "../lib/contexts";

import type {
  LlmOutputField,
  PromptCatalog,
  PromptContext,
  PromptCreatePayload,
  PromptDetail,
  PromptForkPayload,
  PromptRead,
  PromptRenderResult,
  PromptVersionRead,
} from "@/lib/types";

export interface PromptDraft {
  body: string;
  systemBody: string;
  outputFields: LlmOutputField[];
  /**
   * Sample value per variable. Local to the session, never a prompt
   * version: this is the corpus you are tuning against, not part of the
   * template, and two people editing one prompt test it on different data.
   */
  values: Record<string, string>;
}

/** Normalize a wire `output_fields` list into builder fields. */
const parseOutputFields = (raw: unknown): LlmOutputField[] =>
  outputFieldsFromConfig({ output_fields: raw ?? [] });

/** Builder fields back to the wire shape (null when empty). */
const toWireFields = (fields: LlmOutputField[]): Record<string, unknown>[] | null =>
  fields.length > 0 ? fields.map((field) => ({ ...field, target: { ...field.target } })) : null;

/**
 * Owns the prompt studio's state: the library list, the selected prompt's
 * detail + versions, the edit draft with its debounced server-rendered
 * preview, and every mutation (create, save version, fork, rename, delete).
 */
export interface PromptStudioOptions {
  /** Open on this prompt instead of the `?prompt=` deep link. */
  initialPromptId?: string | null;
  /** Mirror the selection into the address bar (the page, not the overlay). */
  trackUrl?: boolean;
}

export function usePromptStudio(token: string | null, options: PromptStudioOptions = {}) {
  const { initialPromptId = null, trackUrl = false } = options;
  const searchParams = useSearchParams();
  const deepLinkedPromptId = useRef<string | null>(
    initialPromptId ?? searchParams?.get("prompt") ?? null,
  );

  const [selectedId, setSelectedId] = useState<string | null>(deepLinkedPromptId.current);
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [versions, setVersions] = useState<PromptVersionRead[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [draft, setDraft] = useState<PromptDraft>({
    body: "",
    systemBody: "",
    outputFields: [],
    values: {},
  });
  const [preview, setPreview] = useState<PromptRenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const promptsQuery = useApiQuery(
    useCallback(async () => (token ? listPrompts(token) : []), [token]),
    [token],
  );
  const catalogsQuery = useApiQuery(
    useCallback(async () => (token ? listPromptCatalogs(token) : []), [token]),
    [token],
  );

  const prompts: PromptRead[] = useMemo(() => promptsQuery.data ?? [], [promptsQuery.data]);
  const catalogs: PromptCatalog[] = useMemo(() => catalogsQuery.data ?? [], [catalogsQuery.data]);

  const catalogFor = useCallback(
    (context: PromptContext): PromptCatalog | null =>
      catalogs.find((catalog) => catalog.context === context) ?? null,
    [catalogs],
  );

  const loadDetail = useCallback(
    async (promptId: string, attempt = 0) => {
      if (!token) return;
      setDetailLoading(true);
      setError(null);
      try {
        const [nextDetail, nextVersions] = await Promise.all([
          getPrompt(token, promptId),
          listPromptVersions(token, promptId),
        ]);
        setDetail(nextDetail);
        setVersions(nextVersions);
        setDraft((previous) => ({
          body: nextDetail.body,
          systemBody: nextDetail.system_body ?? "",
          outputFields: parseOutputFields(nextDetail.output_fields),
          // Sample values survive switching prompts inside one context —
          // the query you are tuning against does not change because you
          // opened the neighbouring prompt to compare.
          values: previous.values,
        }));
      } catch (loadError) {
        // A prompt created a beat ago can 404 while the create request's
        // session finishes committing — retry briefly before reporting.
        if (loadError instanceof ApiError && loadError.status === 404 && attempt < 2) {
          window.setTimeout(() => void loadDetail(promptId, attempt + 1), 300);
          return;
        }
        setError(getErrorMessage(loadError, "Unable to load the prompt."));
      } finally {
        setDetailLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
      setVersions([]);
    }
  }, [loadDetail, selectedId]);

  // Keep the address bar on the prompt being edited so a refresh or a
  // shared link lands where the user was. `replaceState` rather than a
  // router push: this is where you already are, not a step in history.
  useEffect(() => {
    if (!trackUrl || !selectedId || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("prompt") === selectedId) return;
    url.searchParams.set("prompt", selectedId);
    window.history.replaceState(window.history.state, "", url);
  }, [selectedId, trackUrl]);

  // If nothing is selected once the list arrives, select the first prompt —
  // re-finding a deep-linked id rather than resetting to [0] on refetch.
  useEffect(() => {
    if (selectedId || prompts.length === 0) return;
    setSelectedId(deepLinkedPromptId.current ?? prompts[0].id);
    deepLinkedPromptId.current = null;
  }, [prompts, selectedId]);

  // Debounced server-side preview of the current draft.
  useEffect(() => {
    if (!token || !detail) {
      setPreview(null);
      return;
    }
    const handle = window.setTimeout(() => {
      renderPrompt(token, {
        body: draft.body,
        system_body: draft.systemBody || null,
        context: detail.context,
        values: draft.values,
      })
        .then(setPreview)
        .catch(() => {
          // Keep the previous preview; the editor still shows the draft.
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [detail, draft.body, draft.systemBody, draft.values, token]);

  // Sample values are session state, not part of the prompt, so they are
  // deliberately excluded — typing a test query is not an unsaved change.
  const hasChanges = useMemo(() => {
    if (!detail) return false;
    return (
      draft.body !== detail.body ||
      draft.systemBody !== (detail.system_body ?? "") ||
      JSON.stringify(draft.outputFields) !== JSON.stringify(parseOutputFields(detail.output_fields))
    );
  }, [detail, draft.body, draft.systemBody, draft.outputFields]);

  const runMutation = useCallback(
    async (mutation: () => Promise<void>, fallback: string) => {
      if (!token) return false;
      setMutating(true);
      setError(null);
      try {
        await mutation();
        return true;
      } catch (mutationError) {
        setError(getErrorMessage(mutationError, fallback));
        return false;
      } finally {
        setMutating(false);
      }
    },
    [token],
  );

  const handleSaveVersion = useCallback(
    async (label: string | null) => {
      if (!token || !detail) return false;
      return await runMutation(async () => {
        // Apply the response locally instead of refetching: the request
        // session commits at teardown, so an immediate GET can race the
        // write and read the pre-save state.
        const saved = await savePromptVersion(token, detail.id, {
          body: draft.body,
          system_body: draft.systemBody || null,
          label,
          output_fields: isNodeContext(detail.context) ? toWireFields(draft.outputFields) : null,
        });
        setDetail((previous) =>
          previous && previous.id === detail.id
            ? {
                ...previous,
                current_version: saved.version,
                body: saved.body,
                system_body: saved.system_body,
                output_fields: saved.output_fields,
              }
            : previous,
        );
        setVersions((previous) => [saved, ...previous]);
        promptsQuery.reload();
      }, "Unable to save the version.");
    },
    [detail, draft, promptsQuery, runMutation, token],
  );

  const handleCreate = useCallback(
    async (payload: PromptCreatePayload) => {
      if (!token) return false;
      return runMutation(async () => {
        const created = await createPrompt(token, payload);
        await promptsQuery.reload();
        setSelectedId(created.id);
      }, "Unable to create the prompt.");
    },
    [promptsQuery, runMutation, token],
  );

  // A fork carries the current draft — fork-and-edit is how a read-only
  // shipped prompt's changes become v1 of an owned prompt. It returns the
  // new prompt so a caller that opened the studio from a node can point
  // that node at it; otherwise the user's edit is a silent no-op.
  const handleFork = useCallback(
    async (payload: PromptForkPayload): Promise<PromptRead | null> => {
      if (!token || !detail) return null;
      const context = payload.context ?? detail.context;
      let created: PromptRead | null = null;
      await runMutation(async () => {
        created = await forkPrompt(token, detail.id, {
          ...payload,
          body: draft.body,
          system_body: draft.systemBody || null,
          output_fields: isNodeContext(context) ? toWireFields(draft.outputFields) : null,
        });
        await promptsQuery.reload();
        setSelectedId(created.id);
      }, "Unable to fork the prompt.");
      return created;
    },
    [detail, draft, promptsQuery, runMutation, token],
  );

  const handleRename = useCallback(
    async (name: string, description: string | null) => {
      if (!token || !detail) return false;
      return runMutation(async () => {
        await updatePrompt(token, detail.id, { name, description });
        await Promise.all([loadDetail(detail.id), promptsQuery.reload()]);
      }, "Unable to rename the prompt.");
    },
    [detail, loadDetail, promptsQuery, runMutation, token],
  );

  const handleDelete = useCallback(async () => {
    if (!token || !detail) return false;
    return runMutation(async () => {
      await deletePrompt(token, detail.id);
      setSelectedId(null);
      await promptsQuery.reload();
    }, "Unable to delete the prompt.");
  }, [detail, promptsQuery, runMutation, token]);

  const handleRestoreVersion = useCallback((version: PromptVersionRead) => {
    setDraft((previous) => ({
      body: version.body,
      systemBody: version.system_body ?? "",
      outputFields: parseOutputFields(version.output_fields),
      values: previous.values,
    }));
  }, []);

  return {
    prompts,
    promptsLoading: promptsQuery.loading,
    promptsError: promptsQuery.error,
    catalogFor,
    selectedId,
    setSelectedId,
    detail,
    detailLoading,
    versions,
    draft,
    setDraft,
    hasChanges,
    preview,
    error,
    setError,
    mutating,
    handleCreate,
    handleSaveVersion,
    handleFork,
    handleRename,
    handleDelete,
    handleRestoreVersion,
  };
}
