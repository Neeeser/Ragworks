"use client";

import { useState } from "react";

import { useWizardModelChoice } from "@/components/pipelines/hooks/use-wizard-model-choice";
import {
  intakeRequiresVisionModel,
  visionCapabilityVerdict,
} from "@/components/pipelines/lib/intake-capability";
import { modelAvailability } from "@/lib/model-catalog-cache";

import type { WizardModelCatalog } from "@/components/pipelines/CreatePipelineWizardSteps";
import type { IntakeMode } from "@/components/pipelines/lib/pipeline-scaffold";
import type { ModelAvailability } from "@/lib/model-catalog-cache";
import type { CatalogModel } from "@/lib/types";

export type WizardVisionModel = {
  /** Whether the chosen intake wires a vision node at all. */
  needed: boolean;
  choice: ReturnType<typeof useWizardModelChoice>;
  availability: ModelAvailability;
  /** A model is selected and still in the catalog. */
  ready: boolean;
  /** The model states it cannot read images — the wizard gates on this. */
  conflict: string | null;
  /** The model states nothing about images — dismissible. */
  capabilityUnknown: string | null;
  selectedName: string | null;
  dismissCapabilityWarning: () => void;
};

/**
 * The vision model the described-images intake collects, and what it says
 * about that intake.
 *
 * Separate from the rest of the wizard's state because it exists only for one
 * intake preset: every other preset leaves this untouched.
 */
export function useWizardVisionModel(
  intake: IntakeMode,
  catalog: WizardModelCatalog,
  active: boolean,
): WizardVisionModel {
  const choice = useWizardModelChoice();
  // Which (connection, model) pair the capability warning was dismissed for.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const needed = active && intakeRequiresVisionModel(intake);
  const availability = modelAvailability(
    catalog.catalog,
    choice.connectionId,
    choice.modelId || null,
  );
  const selected: CatalogModel | null =
    catalog.models.find(
      (model) => model.id === choice.modelId && model.connection_id === choice.connectionId,
    ) ?? null;
  const verdict = needed ? visionCapabilityVerdict(intake, selected) : ({ status: "ok" } as const);
  const warningKey = `${intake}:${choice.connectionId}:${choice.modelId}`;

  return {
    needed,
    choice,
    availability,
    ready: Boolean(choice.modelId && choice.connectionId && availability !== "missing"),
    conflict: verdict.status === "conflict" ? verdict.reason : null,
    capabilityUnknown:
      verdict.status === "unstated" && dismissedFor !== warningKey ? verdict.reason : null,
    selectedName: selected?.name ?? (choice.modelId || null),
    dismissCapabilityWarning: () => setDismissedFor(warningKey),
  };
}
