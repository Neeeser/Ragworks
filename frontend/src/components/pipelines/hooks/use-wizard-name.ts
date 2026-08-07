"use client";

import { useMemo, useState } from "react";

export type WizardName = {
  value: string;
  set: (value: string) => void;
};

/**
 * The pipeline name the wizard will create under, seeded from the chosen
 * template.
 *
 * The suggestion describes the template, so it follows the template choice
 * until the user writes their own name — keeping the previous suggestion
 * across a template switch creates a pipeline named after a template it isn't.
 * Emptying the field re-arms the suggestion: a blank name is not a name the
 * user wrote.
 */
export function useWizardName(suggestion: string): WizardName {
  const [value, setValue] = useState(suggestion);
  const [edited, setEdited] = useState(false);
  const [seeded, setSeeded] = useState(suggestion);

  // A render-time adjustment rather than an effect: the seed is derived from
  // a prop, and an effect would paint the stale name for a frame first.
  if (!edited && suggestion !== seeded) {
    setSeeded(suggestion);
    setValue(suggestion);
  }

  return useMemo(
    () => ({
      value,
      set: (next: string) => {
        setEdited(next.trim().length > 0);
        setValue(next);
      },
    }),
    [value],
  );
}
