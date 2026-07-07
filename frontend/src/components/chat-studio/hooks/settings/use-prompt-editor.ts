"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getBasePrompt,
  getCollectionPrompt,
  updateBasePrompt,
  updateCollectionPrompt,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { Collection, PromptDetails } from "@/lib/types";

export interface PromptSection {
  id: string;
  label: string;
  scope: "base" | "collection";
  details: PromptDetails | null;
  draft: string;
  hasChanges: boolean;
  saving: boolean;
  error: string | null;
}

export interface PromptSectionSummary {
  id: string;
  label: string;
  scope: "base" | "collection";
  isCustom: boolean;
}

interface UsePromptEditorParams {
  authToken: string;
  authLoading: boolean;
  selectedToolCollectionIds: string[];
  selectedToolCollections: Collection[];
}

interface UsePromptEditorResult {
  promptEditorRef: React.RefObject<HTMLTextAreaElement | null>;
  promptEditorOpen: boolean;
  activePromptSectionId: string;
  basePromptDetails: PromptDetails | null;
  promptSections: PromptSection[];
  promptSectionsSummary: PromptSectionSummary[];
  promptPreviewMarkdown: string;
  promptLoading: boolean;
  promptError: string | null;
  promptGeneratedAt: string | null;
  handlePromptEditorOpen: () => void;
  handlePromptEditorClose: () => void;
  handlePromptSectionSelect: (sectionId: string) => void;
  handlePromptDraftChange: (sectionId: string, value: string) => void;
  handlePromptSave: (sectionId: string) => Promise<void>;
  handlePromptReset: (sectionId: string) => void;
  handleInsertPromptVariable: (sectionId: string, variableName: string) => void;
}

const PROMPT_SAVE_ERROR = "Unable to update the system prompt right now.";

/**
 * Owns the base + per-collection system prompt state: fetching, drafts, preview
 * composition, and the editor overlay handlers. Errors are surfaced per-section
 * rather than through the global status channel, matching the original behavior.
 */
export function usePromptEditor({
  authToken,
  authLoading,
  selectedToolCollectionIds,
  selectedToolCollections,
}: UsePromptEditorParams): UsePromptEditorResult {
  const [basePromptDetails, setBasePromptDetails] = useState<PromptDetails | null>(null);
  const [basePromptLoading, setBasePromptLoading] = useState(false);
  const [basePromptError, setBasePromptError] = useState<string | null>(null);
  const [basePromptDraft, setBasePromptDraft] = useState("");
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [activePromptSectionId, setActivePromptSectionId] = useState("base");
  const [collectionPromptDetails, setCollectionPromptDetails] = useState<
    Record<string, PromptDetails>
  >({});
  const [collectionPromptDrafts, setCollectionPromptDrafts] = useState<Record<string, string>>({});
  const [collectionPromptLoading, setCollectionPromptLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [collectionPromptErrors, setCollectionPromptErrors] = useState<
    Record<string, string | null>
  >({});
  const [promptSavingBySection, setPromptSavingBySection] = useState<Record<string, boolean>>({});
  const promptEditorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (authLoading || !authToken) {
      setBasePromptDetails(null);
      setBasePromptDraft("");
      return;
    }
    let cancelled = false;
    setBasePromptLoading(true);
    setBasePromptError(null);
    getBasePrompt(authToken)
      .then((details) => {
        if (cancelled) return;
        setBasePromptDetails(details);
        setBasePromptDraft((prev) => (prev ? prev : (details.template ?? "")));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBasePromptError(getErrorMessage(error, "Unable to load the base prompt."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBasePromptLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken]);

  useEffect(() => {
    if (authLoading || !authToken || selectedToolCollectionIds.length === 0) {
      return;
    }
    selectedToolCollectionIds.forEach((collectionId) => {
      if (collectionPromptDetails[collectionId]) {
        return;
      }
      setCollectionPromptLoading((prev) => ({ ...prev, [collectionId]: true }));
      setCollectionPromptErrors((prev) => ({ ...prev, [collectionId]: null }));
      getCollectionPrompt(authToken, collectionId)
        .then((details) => {
          setCollectionPromptDetails((prev) => ({ ...prev, [collectionId]: details }));
          setCollectionPromptDrafts((prev) => {
            if (prev[collectionId] !== undefined) {
              return prev;
            }
            return { ...prev, [collectionId]: details.template ?? "" };
          });
        })
        .catch((error: unknown) => {
          setCollectionPromptErrors((prev) => ({
            ...prev,
            [collectionId]: getErrorMessage(error, "Unable to load the tool prompt."),
          }));
        })
        .finally(() => {
          setCollectionPromptLoading((prev) => ({ ...prev, [collectionId]: false }));
        });
    });
  }, [authLoading, authToken, collectionPromptDetails, selectedToolCollectionIds]);

  const substitutePromptVariables = useCallback(
    (templateValue: string, context?: Record<string, string>) => {
      if (!templateValue) return "";
      if (!context) return templateValue;
      return templateValue.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, rawKey) => {
        const key = String(rawKey).trim();
        return context?.[key] ?? `{{${key}}}`;
      });
    },
    [],
  );

  const basePromptTemplate = useMemo(() => {
    return basePromptDraft || basePromptDetails?.template || "";
  }, [basePromptDetails?.template, basePromptDraft]);

  const basePromptPreview = useMemo(() => {
    return substitutePromptVariables(basePromptTemplate, basePromptDetails?.context);
  }, [basePromptDetails?.context, basePromptTemplate, substitutePromptVariables]);

  const toolPromptPreviews = useMemo(() => {
    return selectedToolCollections
      .map((collection) => {
        const details = collectionPromptDetails[collection.id];
        const draft = collectionPromptDrafts[collection.id] ?? details?.template ?? "";
        return substitutePromptVariables(draft, details?.context);
      })
      .filter((section) => section.trim().length > 0);
  }, [
    collectionPromptDetails,
    collectionPromptDrafts,
    selectedToolCollections,
    substitutePromptVariables,
  ]);

  const promptPreviewMarkdown = useMemo(() => {
    return [basePromptPreview, ...toolPromptPreviews]
      .map((section) => section.trim())
      .filter(Boolean)
      .join("\n\n");
  }, [basePromptPreview, toolPromptPreviews]);

  const basePromptHasChanges = useMemo(() => {
    if (!basePromptDetails) {
      return Boolean(basePromptDraft);
    }
    return basePromptDraft !== (basePromptDetails.template ?? "");
  }, [basePromptDetails, basePromptDraft]);

  const promptSections = useMemo<PromptSection[]>(() => {
    const sections: PromptSection[] = [
      {
        id: "base",
        label: "Base",
        scope: "base",
        details: basePromptDetails,
        draft: basePromptDraft,
        hasChanges: basePromptHasChanges,
        saving: Boolean(promptSavingBySection.base),
        error: basePromptError,
      },
    ];
    selectedToolCollections.forEach((collection) => {
      const details = collectionPromptDetails[collection.id] ?? null;
      const draft = collectionPromptDrafts[collection.id] ?? details?.template ?? "";
      const hasChanges = details ? draft !== (details.template ?? "") : draft.trim().length > 0;
      sections.push({
        id: collection.id,
        label: collection.name,
        scope: "collection",
        details,
        draft,
        hasChanges,
        saving: Boolean(promptSavingBySection[collection.id]),
        error: collectionPromptErrors[collection.id] ?? null,
      });
    });
    return sections;
  }, [
    basePromptDetails,
    basePromptDraft,
    basePromptError,
    basePromptHasChanges,
    collectionPromptDetails,
    collectionPromptDrafts,
    collectionPromptErrors,
    promptSavingBySection,
    selectedToolCollections,
  ]);

  const promptSectionsSummary = useMemo<PromptSectionSummary[]>(() => {
    return promptSections.map((section) => ({
      id: section.id,
      label: section.label,
      scope: section.scope,
      isCustom: Boolean(section.details?.is_custom),
    }));
  }, [promptSections]);

  const promptLoading =
    basePromptLoading ||
    selectedToolCollectionIds.some((collectionId) => collectionPromptLoading[collectionId]);
  const promptError =
    basePromptError ??
    selectedToolCollectionIds
      .map((collectionId) => collectionPromptErrors[collectionId])
      .find((value) => Boolean(value)) ??
    null;
  const promptGeneratedAt = basePromptDetails?.context?.["datetime.iso"] ?? null;

  useEffect(() => {
    if (
      activePromptSectionId !== "base" &&
      !selectedToolCollectionIds.includes(activePromptSectionId)
    ) {
      setActivePromptSectionId("base");
    }
  }, [activePromptSectionId, selectedToolCollectionIds]);

  const handlePromptEditorOpen = useCallback(() => {
    if (promptSections.length > 0) {
      const isActiveValid = promptSections.some((section) => section.id === activePromptSectionId);
      if (!isActiveValid) {
        setActivePromptSectionId("base");
      }
    }
    setPromptEditorOpen(true);
    window.setTimeout(() => {
      promptEditorRef.current?.focus();
    }, 20);
  }, [activePromptSectionId, promptSections]);

  const handlePromptEditorClose = useCallback(() => {
    setPromptEditorOpen(false);
  }, []);

  const updatePromptDraft = useCallback((sectionId: string, updater: (value: string) => string) => {
    if (sectionId === "base") {
      setBasePromptDraft(updater);
      return;
    }
    setCollectionPromptDrafts((prev) => {
      const current = prev[sectionId] ?? "";
      return { ...prev, [sectionId]: updater(current) };
    });
  }, []);

  const handleInsertPromptVariable = useCallback(
    (sectionId: string, variableName: string) => {
      const insertion = `{{${variableName}}}`;
      updatePromptDraft(sectionId, (prev) => {
        const textarea = promptEditorRef.current;
        if (textarea) {
          const start = textarea.selectionStart ?? prev.length;
          const end = textarea.selectionEnd ?? prev.length;
          const next = prev.slice(0, start) + insertion + prev.slice(end);
          window.requestAnimationFrame(() => {
            const cursor = start + insertion.length;
            textarea.selectionStart = cursor;
            textarea.selectionEnd = cursor;
            textarea.focus();
          });
          return next;
        }
        const spacer = prev.endsWith(" ") || prev.endsWith("\n") || prev.length === 0 ? "" : " ";
        return `${prev}${spacer}${insertion}`;
      });
    },
    [updatePromptDraft],
  );

  const handlePromptReset = useCallback(
    (sectionId: string) => {
      updatePromptDraft(sectionId, () => "");
      window.requestAnimationFrame(() => {
        promptEditorRef.current?.focus();
      });
    },
    [updatePromptDraft],
  );

  const handlePromptSave = useCallback(
    async (sectionId: string) => {
      if (!authToken) {
        if (sectionId === "base") {
          setBasePromptError("Sign in to update the system prompt.");
        } else {
          setCollectionPromptErrors((prev) => ({
            ...prev,
            [sectionId]: "Sign in to update the system prompt.",
          }));
        }
        return;
      }
      setPromptSavingBySection((prev) => ({ ...prev, [sectionId]: true }));
      if (sectionId === "base") {
        setBasePromptError(null);
        try {
          const updated = await updateBasePrompt(authToken, basePromptDraft);
          setBasePromptDetails(updated);
          setBasePromptDraft(updated.template ?? "");
          setPromptEditorOpen(false);
        } catch (error) {
          setBasePromptError(getErrorMessage(error, PROMPT_SAVE_ERROR));
        } finally {
          setPromptSavingBySection((prev) => ({ ...prev, [sectionId]: false }));
        }
        return;
      }
      setCollectionPromptErrors((prev) => ({ ...prev, [sectionId]: null }));
      try {
        const draft = collectionPromptDrafts[sectionId] ?? "";
        const updated = await updateCollectionPrompt(authToken, sectionId, draft);
        setCollectionPromptDetails((prev) => ({ ...prev, [sectionId]: updated }));
        setCollectionPromptDrafts((prev) => ({
          ...prev,
          [sectionId]: updated.template ?? "",
        }));
        setPromptEditorOpen(false);
      } catch (error) {
        setCollectionPromptErrors((prev) => ({
          ...prev,
          [sectionId]: getErrorMessage(error, PROMPT_SAVE_ERROR),
        }));
      } finally {
        setPromptSavingBySection((prev) => ({ ...prev, [sectionId]: false }));
      }
    },
    [authToken, basePromptDraft, collectionPromptDrafts],
  );

  const handlePromptSectionSelect = useCallback((sectionId: string) => {
    setActivePromptSectionId(sectionId);
  }, []);

  const handlePromptDraftChange = useCallback(
    (sectionId: string, value: string) => {
      updatePromptDraft(sectionId, () => value);
    },
    [updatePromptDraft],
  );

  return {
    promptEditorRef,
    promptEditorOpen,
    activePromptSectionId,
    basePromptDetails,
    promptSections,
    promptSectionsSummary,
    promptPreviewMarkdown,
    promptLoading,
    promptError,
    promptGeneratedAt,
    handlePromptEditorOpen,
    handlePromptEditorClose,
    handlePromptSectionSelect,
    handlePromptDraftChange,
    handlePromptSave,
    handlePromptReset,
    handleInsertPromptVariable,
  };
}
