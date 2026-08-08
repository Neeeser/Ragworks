/**
 * What an intake preset needs from the embedding model, and whether the
 * selected model states it.
 *
 * The image intakes hand the embedder image items; a text-only embedder
 * rejects every one of them, so the pipeline indexes nothing. Capability
 * marks are additive claims (`lib/model-capabilities.ts`): a model that lists
 * its input modalities and omits `image` has *stated* it cannot read them,
 * which is a conflict worth blocking on, while a model that publishes no
 * modalities at all has stated nothing — that is a warning, never a refusal.
 */

import { deriveCapabilities } from "@/lib/model-capabilities";

import type { IntakeMode } from "@/components/pipelines/lib/pipeline-scaffold";
import type { ModelCapabilityId } from "@/lib/model-capabilities";
import type { CatalogModel } from "@/lib/types";

/** The capability each intake preset requires of the embedding model. */
const REQUIRED_CAPABILITY: Record<IntakeMode, ModelCapabilityId | null> = {
  text: null,
  text_images: "image_in",
  images: "image_in",
};

export type IntakeCapabilityVerdict =
  /** The preset needs nothing the model does not state. */
  | { status: "ok" }
  /** The model states its inputs and the required one is not among them. */
  | { status: "conflict"; reason: string }
  /** The model states no inputs, so the requirement can't be checked. */
  | { status: "unstated"; reason: string };

const OK: IntakeCapabilityVerdict = { status: "ok" };

/** The label the wizard's preset cards use, for messages naming the preset. */
const INTAKE_LABEL: Record<IntakeMode, string> = {
  text: "Text documents",
  text_images: "Text + images",
  images: "Everything as images",
};

/**
 * Whether `model` can serve `intake`, and why not when it cannot.
 *
 * `intakeRequiresImages` is the only requirement today; the record above is
 * where a second one goes.
 */
export function intakeCapabilityVerdict(
  intake: IntakeMode,
  model: CatalogModel | null,
): IntakeCapabilityVerdict {
  const required = REQUIRED_CAPABILITY[intake];
  if (!required || !model) return OK;
  if (deriveCapabilities(model).includes(required)) return OK;
  const preset = INTAKE_LABEL[intake];
  // An empty modality list is a provider that publishes nothing, not a model
  // that refused the modality.
  if ((model.input_modalities ?? []).length === 0) {
    return {
      status: "unstated",
      reason:
        `${model.name} does not state whether it reads images. "${preset}" sends it ` +
        "images, so the pipeline indexes nothing if it cannot. Create it and run a " +
        "file through to find out, or pick a model that states image input.",
    };
  }
  return {
    status: "conflict",
    reason:
      `${model.name} reads ${(model.input_modalities ?? []).join(", ")} only, and ` +
      `"${preset}" sends it images. Pick an embedding model that reads images, or ` +
      "an intake preset that sends text.",
  };
}

/** True where the preset hands the embedder images. */
export function intakeRequiresImages(intake: IntakeMode): boolean {
  return REQUIRED_CAPABILITY[intake] === "image_in";
}
