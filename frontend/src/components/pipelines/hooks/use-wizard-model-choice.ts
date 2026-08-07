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

/**
 * One `(provider connection, model)` pair the wizard collects.
 *
 * The connection label is kept alongside the ids because a background catalog
 * refresh can drop the model from the list, and the picker still has to name
 * the connection the missing selection came from.
 */
export function useWizardModelChoice(): WizardModelChoice {
  const [modelId, setModelId] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [connectionLabel, setConnectionLabel] = useState<string | null>(null);

  const select = useCallback((model: CatalogModel) => {
    setModelId(model.id);
    setConnectionId(model.connection_id);
    setConnectionLabel(model.connection_label);
  }, []);

  const reset = useCallback(() => {
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
