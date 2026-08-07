"use client";

import { useCallback, useMemo, useState } from "react";

import type { CatalogModel } from "@/lib/types";

export type WizardModelChoice = {
  modelId: string;
  connectionId: string | null;
  connectionLabel: string | null;
  select: (model: CatalogModel) => void;
  reset: () => void;
};

const keyOf = (model: CatalogModel | null): string =>
  model ? `${model.connection_id}:${model.id}` : "";

/**
 * One `(provider connection, model)` pair the wizard collects.
 *
 * The connection label is kept alongside the ids because a background catalog
 * refresh can drop the model from the list, and the picker still has to name
 * the connection the missing selection came from.
 *
 * A `suggestion` seeds the pair and re-seeds whenever it changes, until the
 * user picks a model themselves — so retargeting the wizard at another index
 * moves the suggested model with it instead of leaving the previous one.
 */
export function useWizardModelChoice(suggestion: CatalogModel | null = null): WizardModelChoice {
  const [modelId, setModelId] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [connectionLabel, setConnectionLabel] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);
  const [seeded, setSeeded] = useState("");

  // A render-time adjustment rather than an effect: the suggestion arrives
  // with an async load, and an effect would paint the empty picker first.
  if (!chosen && suggestion && keyOf(suggestion) !== seeded) {
    setSeeded(keyOf(suggestion));
    setModelId(suggestion.id);
    setConnectionId(suggestion.connection_id);
    setConnectionLabel(suggestion.connection_label);
  }

  const select = useCallback((model: CatalogModel) => {
    setChosen(true);
    setModelId(model.id);
    setConnectionId(model.connection_id);
    setConnectionLabel(model.connection_label);
  }, []);

  const reset = useCallback(() => {
    setChosen(false);
    setSeeded("");
    setModelId("");
    setConnectionId(null);
    setConnectionLabel(null);
  }, []);

  // Memoised so an effect depending on the choice (the wizard's reset on
  // open) re-runs when the selection changes, not on every render.
  return useMemo(
    () => ({ modelId, connectionId, connectionLabel, select, reset }),
    [modelId, connectionId, connectionLabel, select, reset],
  );
}
