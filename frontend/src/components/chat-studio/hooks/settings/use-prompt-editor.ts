"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getBasePrompt,
  getCollectionPrompt,
  getPrompt,
  listPrompts,
  listPromptVersions,
  updateBasePrompt,
  updateCollectionPrompt,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { Collection, PromptRead, PromptSelection, PromptVersionSelector } from "@/lib/types";

export interface PromptChoice {
  promptId: string;
  version: PromptVersionSelector;
}

export interface PromptSection {
  id: string;
  label: string;
  scope: "base" | "collection";
  selection: PromptSelection | null;
  choice: PromptChoice | null;
  /** Body of the drafted choice (the saved body until the choice changes). */
  choiceBody: string;
  hasChanges: boolean;
  saving: boolean;
  error: string | null;
}

export interface PromptSectionSummary {
  id: string;
  label: string;
  scope: "base" | "collection";
  promptName: string | null;
  isCustom: boolean;
}

interface UsePromptEditorParams {
  authToken: string;
  authLoading: boolean;
  selectedToolCollectionIds: string[];
  selectedToolCollections: Collection[];
}

const PROMPT_SAVE_ERROR = "Unable to update the system prompt right now.";

function substituteVariables(template: string, context?: Record<string, string>): string {
  if (!template) return "";
  if (!context) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, rawKey) => {
    const key = String(rawKey).trim();
    return context?.[key] ?? `{{${key}}}`;
  });
}

function choiceFromSelection(selection: PromptSelection | null): PromptChoice | null {
  if (!selection?.reference) return null;
  return {
    promptId: selection.reference.prompt_id,
    version: selection.reference.version,
  };
}

function sameChoice(a: PromptChoice | null, b: PromptChoice | null): boolean {
  if (!a || !b) return a === b;
  return a.promptId === b.promptId && a.version === b.version;
}

/**
 * Owns the base + per-collection prompt selections: which library prompt each
 * section references (Docker-tag style version pinning), the drafted choice
 * before saving, and the assembled preview. Prompt bodies are always resolved
 * from the library — there is no inline template state anymore.
 */
export function usePromptEditor({
  authToken,
  authLoading,
  selectedToolCollectionIds,
  selectedToolCollections,
}: UsePromptEditorParams) {
  const [baseSelection, setBaseSelection] = useState<PromptSelection | null>(null);
  const [basePromptLoading, setBasePromptLoading] = useState(false);
  const [basePromptError, setBasePromptError] = useState<string | null>(null);
  const [collectionSelections, setCollectionSelections] = useState<Record<string, PromptSelection>>(
    {},
  );
  const [collectionErrors, setCollectionErrors] = useState<Record<string, string | null>>({});
  const [collectionLoading, setCollectionLoading] = useState<Record<string, boolean>>({});
  const [choices, setChoices] = useState<Record<string, PromptChoice | null>>({});
  const [choiceBodies, setChoiceBodies] = useState<Record<string, string>>({});
  const [savingBySection, setSavingBySection] = useState<Record<string, boolean>>({});
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [activePromptSectionId, setActivePromptSectionId] = useState("base");
  const [libraryPrompts, setLibraryPrompts] = useState<PromptRead[]>([]);

  useEffect(() => {
    if (authLoading || !authToken) {
      setBaseSelection(null);
      return;
    }
    let cancelled = false;
    setBasePromptLoading(true);
    setBasePromptError(null);
    getBasePrompt(authToken)
      .then((selection) => {
        if (cancelled) return;
        setBaseSelection(selection);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBasePromptError(getErrorMessage(error, "Unable to load the base prompt."));
        }
      })
      .finally(() => {
        if (!cancelled) setBasePromptLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken]);

  useEffect(() => {
    if (authLoading || !authToken) return;
    let cancelled = false;
    listPrompts(authToken)
      .then((prompts) => {
        if (!cancelled) setLibraryPrompts(prompts);
      })
      .catch(() => {
        // The pickers degrade to the saved selection; errors surface on save.
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken, promptEditorOpen]);

  useEffect(() => {
    if (authLoading || !authToken || selectedToolCollectionIds.length === 0) {
      return;
    }
    selectedToolCollectionIds.forEach((collectionId) => {
      if (collectionSelections[collectionId]) {
        return;
      }
      setCollectionLoading((prev) => ({ ...prev, [collectionId]: true }));
      setCollectionErrors((prev) => ({ ...prev, [collectionId]: null }));
      getCollectionPrompt(authToken, collectionId)
        .then((selection) => {
          setCollectionSelections((prev) => ({ ...prev, [collectionId]: selection }));
        })
        .catch((error: unknown) => {
          setCollectionErrors((prev) => ({
            ...prev,
            [collectionId]: getErrorMessage(error, "Unable to load the tool prompt."),
          }));
        })
        .finally(() => {
          setCollectionLoading((prev) => ({ ...prev, [collectionId]: false }));
        });
    });
  }, [authLoading, authToken, collectionSelections, selectedToolCollectionIds]);

  const selectionFor = useCallback(
    (sectionId: string): PromptSelection | null =>
      sectionId === "base" ? baseSelection : (collectionSelections[sectionId] ?? null),
    [baseSelection, collectionSelections],
  );

  const choiceFor = useCallback(
    (sectionId: string): PromptChoice | null => {
      const drafted = choices[sectionId];
      if (drafted !== undefined) return drafted;
      return choiceFromSelection(selectionFor(sectionId));
    },
    [choices, selectionFor],
  );

  const bodyFor = useCallback(
    (sectionId: string): string => {
      const selection = selectionFor(sectionId);
      const drafted = choices[sectionId];
      if (drafted === undefined || sameChoice(drafted, choiceFromSelection(selection))) {
        return selection?.body ?? "";
      }
      return choiceBodies[sectionId] ?? "";
    },
    [choiceBodies, choices, selectionFor],
  );

  const handlePromptChoice = useCallback(
    (sectionId: string, choice: PromptChoice) => {
      setChoices((prev) => ({ ...prev, [sectionId]: choice }));
      if (!authToken) return;
      const saved = choiceFromSelection(selectionFor(sectionId));
      if (sameChoice(choice, saved)) return;
      const loadBody =
        choice.version === "latest"
          ? getPrompt(authToken, choice.promptId).then((detail) => detail.body)
          : listPromptVersions(authToken, choice.promptId).then(
              (versions) => versions.find((entry) => entry.version === choice.version)?.body ?? "",
            );
      void loadBody
        .then((body) => {
          setChoiceBodies((prev) => ({ ...prev, [sectionId]: body }));
        })
        .catch(() => {
          setChoiceBodies((prev) => ({ ...prev, [sectionId]: "" }));
        });
    },
    [authToken, selectionFor],
  );

  const promptSections = useMemo<PromptSection[]>(() => {
    const build = (
      id: string,
      label: string,
      scope: "base" | "collection",
      error: string | null,
    ): PromptSection => {
      const selection = selectionFor(id);
      const choice = choiceFor(id);
      return {
        id,
        label,
        scope,
        selection,
        choice,
        choiceBody: bodyFor(id),
        hasChanges: !sameChoice(choice, choiceFromSelection(selection)),
        saving: Boolean(savingBySection[id]),
        error,
      };
    };
    const sections = [build("base", "Base", "base", basePromptError)];
    selectedToolCollections.forEach((collection) => {
      sections.push(
        build(
          collection.id,
          collection.name,
          "collection",
          collectionErrors[collection.id] ?? null,
        ),
      );
    });
    return sections;
  }, [
    basePromptError,
    bodyFor,
    choiceFor,
    collectionErrors,
    savingBySection,
    selectedToolCollections,
    selectionFor,
  ]);

  const promptSectionsSummary = useMemo<PromptSectionSummary[]>(
    () =>
      promptSections.map((section) => ({
        id: section.id,
        label: section.label,
        scope: section.scope,
        promptName: section.selection?.prompt?.name ?? null,
        isCustom: section.selection?.prompt?.source === "user",
      })),
    [promptSections],
  );

  const promptPreviewMarkdown = useMemo(() => {
    const sections = promptSections.map((section) =>
      substituteVariables(section.choiceBody, section.selection?.context),
    );
    return sections
      .map((section) => section.trim())
      .filter(Boolean)
      .join("\n\n");
  }, [promptSections]);

  const promptLoading =
    basePromptLoading ||
    selectedToolCollectionIds.some((collectionId) => collectionLoading[collectionId]);
  const promptError =
    basePromptError ??
    selectedToolCollectionIds
      .map((collectionId) => collectionErrors[collectionId])
      .find((value) => Boolean(value)) ??
    null;
  const promptGeneratedAt = baseSelection?.context?.["datetime.iso"] ?? null;

  useEffect(() => {
    if (
      activePromptSectionId !== "base" &&
      !selectedToolCollectionIds.includes(activePromptSectionId)
    ) {
      setActivePromptSectionId("base");
    }
  }, [activePromptSectionId, selectedToolCollectionIds]);

  const handlePromptEditorOpen = useCallback(() => {
    setPromptEditorOpen(true);
  }, []);

  const handlePromptEditorClose = useCallback(() => {
    setPromptEditorOpen(false);
    setChoices({});
    setChoiceBodies({});
  }, []);

  const handlePromptSave = useCallback(
    async (sectionId: string) => {
      const choice = choiceFor(sectionId);
      if (!authToken || !choice) return;
      setSavingBySection((prev) => ({ ...prev, [sectionId]: true }));
      const payload = { prompt_id: choice.promptId, version: choice.version };
      try {
        if (sectionId === "base") {
          setBasePromptError(null);
          const updated = await updateBasePrompt(authToken, payload);
          setBaseSelection(updated);
        } else {
          setCollectionErrors((prev) => ({ ...prev, [sectionId]: null }));
          const updated = await updateCollectionPrompt(authToken, sectionId, payload);
          setCollectionSelections((prev) => ({ ...prev, [sectionId]: updated }));
        }
        setChoices((prev) => {
          const next = { ...prev };
          delete next[sectionId];
          return next;
        });
        setPromptEditorOpen(false);
      } catch (error) {
        const message = getErrorMessage(error, PROMPT_SAVE_ERROR);
        if (sectionId === "base") {
          setBasePromptError(message);
        } else {
          setCollectionErrors((prev) => ({ ...prev, [sectionId]: message }));
        }
      } finally {
        setSavingBySection((prev) => ({ ...prev, [sectionId]: false }));
      }
    },
    [authToken, choiceFor],
  );

  const handlePromptSectionSelect = useCallback((sectionId: string) => {
    setActivePromptSectionId(sectionId);
  }, []);

  return {
    promptEditorOpen,
    activePromptSectionId,
    baseSelection,
    libraryPrompts,
    promptSections,
    promptSectionsSummary,
    promptPreviewMarkdown,
    promptLoading,
    promptError,
    promptGeneratedAt,
    handlePromptEditorOpen,
    handlePromptEditorClose,
    handlePromptSectionSelect,
    handlePromptChoice,
    handlePromptSave,
  };
}
