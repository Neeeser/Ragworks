"use client";

import { useState } from "react";

import { useWizardModelChoice } from "@/components/pipelines/hooks/use-wizard-model-choice";
import {
  capabilityNotices,
  intakeRequiresVisionModel,
  visionCapabilityVerdict,
} from "@/components/pipelines/lib/intake-capability";
import { DESCRIBE_PRESET_ID, VISION_NODE_TYPE } from "@/components/pipelines/lib/pipeline-scaffold";
import { presetConfig } from "@/components/pipelines/lib/presets";
import { modelAvailability } from "@/lib/model-catalog-cache";

import type { WizardModelCatalog } from "@/components/pipelines/CreatePipelineWizardSteps";
import type { IntakeMode } from "@/components/pipelines/lib/pipeline-scaffold";
import type { ModelAvailability } from "@/lib/model-catalog-cache";
import type { CatalogModel, NodeSpec } from "@/lib/types";

export type WizardVisionModel = {
  /** Whether the chosen intake wires a vision node at all. */
  needed: boolean;
  choice: ReturnType<typeof useWizardModelChoice>;
  availability: ModelAvailability;
  /**
   * A model is selected and still in the catalog, and the shipped preset that
   * carries the shell's prompt and output fields has loaded.
   */
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
  nodeSpecs: NodeSpec[],
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
  // The shell's prompt and output fields come from the shipped preset, and it
  // refuses to save without either — so Create waits for the node library
  // rather than submitting a graph the server answers with two errors about a
  // node the wizard showed no field for.
  const preset = presetConfig(nodeSpecs, VISION_NODE_TYPE, DESCRIBE_PRESET_ID);

  return {
    needed,
    choice,
    availability,
    ready: Boolean(
      choice.modelId && choice.connectionId && availability !== "missing" && preset !== undefined,
    ),
    ...capabilityNotices(verdict, warningKey, dismissedFor),
    selectedName: selected?.name ?? (choice.modelId || null),
    dismissCapabilityWarning: () => setDismissedFor(warningKey),
  };
}
