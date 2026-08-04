"use client";

import { useState } from "react";

import { useModelShortlist } from "@/components/models/hooks/use-model-shortlist";
import { useLlmModelCatalog } from "@/components/pipelines/hooks/use-llm-model-catalog";
import { useAuth } from "@/providers/auth-provider";

import type { CatalogModel } from "@/lib/types";

export interface UseBenchModelResult {
  model: CatalogModel | null;
  setModel: (model: CatalogModel | null) => void;
}

/**
 * The model the test bench runs against, held above the tab that shows it.
 *
 * Two things this fixes, both costing the user a choice they already made:
 * the bench unmounts whenever the studio switches to the editor, so state
 * owned by the bench is destroyed on every edit-test cycle; and it opened on
 * nothing at all, though the app knows which chat model this user reaches for.
 *
 * Seeding follows the pipeline editor's rule for LLM nodes: fill in the most
 * recent chat model, and invent nothing when there isn't one — an empty
 * picker asks a better question than a guessed model answers.
 *
 * The catalog read is free: `useLlmModelCatalog` goes through the shared
 * catalog cache the bench itself already uses.
 */
export function useBenchModel(): UseBenchModelResult {
  const { token, user } = useAuth();
  const { llmModels } = useLlmModelCatalog(token, user?.id);
  const { recent } = useModelShortlist("chat", llmModels);
  const [model, setModel] = useState<CatalogModel | null>(null);

  // A render-time adjustment rather than an effect: an effect paints the empty
  // picker first and fills it a frame later, and this cannot loop — it fires
  // only while the choice is still empty.
  //
  // The first recent model the catalog *still serves*: a shortlist entry whose
  // connection dropped the model resolves to null, and seeding that would put
  // a model in the picker that no run could use.
  const seed = recent.find((entry) => entry.model !== null)?.model ?? null;
  if (model === null && seed !== null) {
    setModel(seed);
  }

  return { model, setModel };
}
