/**
 * What an intake preset needs from the models it wires, and whether the
 * selected model states it.
 *
 * The image intakes hand the embedder image items; a text-only embedder
 * rejects every one of them, so the pipeline indexes nothing. The described
 * intake sends those images to a vision model instead, so the requirement
 * moves to the chat model and the embedder only ever sees text. Capability
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
  // The vision node reads the images and writes text, so the embedder is
  // handed text like any other intake.
  text_described_images: null,
};

/** The capability each intake preset requires of the vision model it wires. */
const REQUIRED_VISION_CAPABILITY: Record<IntakeMode, ModelCapabilityId | null> = {
  text: null,
  text_images: null,
  images: null,
  text_described_images: "image_in",
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
  text_described_images: "Text + described images",
};

/** What the model in question is being asked to read, phrased for its role. */
type ModelRole = {
  /** How a message names what the preset sends the model. */
  sends: string;
  /** What to do about it, when the model states it cannot read images. */
  remedy: string;
};

const EMBEDDING_ROLE: ModelRole = {
  sends: "sends it images",
  remedy: "Pick an embedding model that reads images, or an intake preset that sends text.",
};

const VISION_ROLE: ModelRole = {
  sends: "sends it images to describe",
  remedy: "Pick a chat model that reads images.",
};

/** Whether `model` states the capability, and why not when it does not. */
function capabilityVerdict(
  required: ModelCapabilityId | null,
  model: CatalogModel | null,
  preset: string,
  role: ModelRole,
): IntakeCapabilityVerdict {
  if (!required || !model) return OK;
  if (deriveCapabilities(model).includes(required)) return OK;
  // An empty modality list is a provider that publishes nothing, not a model
  // that refused the modality.
  if ((model.input_modalities ?? []).length === 0) {
    return {
      status: "unstated",
      reason:
        `${model.name} does not state whether it reads images. "${preset}" ${role.sends}, ` +
        "so the pipeline indexes nothing if it cannot. Create it and run a " +
        "file through to find out, or pick a model that states image input.",
    };
  }
  return {
    status: "conflict",
    reason:
      `${model.name} reads ${(model.input_modalities ?? []).join(", ")} only, and ` +
      `"${preset}" ${role.sends}. ${role.remedy}`,
  };
}

/**
 * Whether `model` can serve `intake` as its embedder, and why not when it
 * cannot.
 */
export function intakeCapabilityVerdict(
  intake: IntakeMode,
  model: CatalogModel | null,
): IntakeCapabilityVerdict {
  return capabilityVerdict(
    REQUIRED_CAPABILITY[intake],
    model,
    INTAKE_LABEL[intake],
    EMBEDDING_ROLE,
  );
}

/** Whether `model` can serve `intake` as its vision model. */
export function visionCapabilityVerdict(
  intake: IntakeMode,
  model: CatalogModel | null,
): IntakeCapabilityVerdict {
  return capabilityVerdict(
    REQUIRED_VISION_CAPABILITY[intake],
    model,
    INTAKE_LABEL[intake],
    VISION_ROLE,
  );
}

/** True where the preset hands the embedder images. */
export function intakeRequiresImages(intake: IntakeMode): boolean {
  return REQUIRED_CAPABILITY[intake] === "image_in";
}

/** True where the preset wires a vision node, so the wizard must collect its model. */
export function intakeRequiresVisionModel(intake: IntakeMode): boolean {
  return REQUIRED_VISION_CAPABILITY[intake] !== null;
}
