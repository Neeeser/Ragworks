import type { CatalogModel } from "@/lib/types";

/**
 * What a model can do, derived from the catalog entry the provider published.
 *
 * Every claim here is *additive*: text is the baseline every model serves and
 * is never badged, and a capability appears only where a provider stated it.
 * The absence of a badge therefore means "not stated", never "cannot" — a
 * provider that publishes no capability tree must not have its models render
 * as less capable than the ones that do.
 */
export type ModelCapabilityId =
  | "tools"
  | "reasoning"
  | "image_in"
  | "audio_in"
  | "video_in"
  | "image_out"
  | "audio_out";

export interface ModelCapabilityDescriptor {
  id: ModelCapabilityId;
  /** Accessible name, also the tooltip text — spelled out, never an abbreviation. */
  label: string;
  /** Which side of the model the capability sits on, which drives its colour. */
  direction: "input" | "output";
}

/**
 * The capability catalog, in display order. Tool calling and reasoning lead
 * because they change whether a model can be used at all for retrieval chat;
 * modalities follow in input-then-output order.
 */
export const MODEL_CAPABILITIES: readonly ModelCapabilityDescriptor[] = [
  { id: "tools", label: "Tool calling", direction: "input" },
  { id: "reasoning", label: "Reasoning", direction: "input" },
  { id: "image_in", label: "Image input (vision)", direction: "input" },
  { id: "audio_in", label: "Audio input", direction: "input" },
  { id: "video_in", label: "Video input", direction: "input" },
  { id: "image_out", label: "Image output", direction: "output" },
  { id: "audio_out", label: "Audio output", direction: "output" },
];

const CAPABILITY_BY_ID = new Map(
  MODEL_CAPABILITIES.map((capability) => [capability.id, capability]),
);

/** The descriptor for one capability id, for rendering a single badge. */
export function capabilityDescriptor(id: ModelCapabilityId): ModelCapabilityDescriptor {
  const descriptor = CAPABILITY_BY_ID.get(id);
  if (!descriptor) {
    throw new Error(`Unknown model capability: ${id}`);
  }
  return descriptor;
}

function hasModality(modalities: string[] | undefined, name: string): boolean {
  return (modalities ?? []).some((entry) => entry.toLowerCase() === name);
}

/**
 * The capabilities a catalog entry states, in display order.
 *
 * `reasoning` is read from the typed `ChatCapabilities.reasoning` style rather
 * than the sampling-knob list: a knob the model rejects comes back named in an
 * error, but a reasoning block sent to a model with none is a hard 400 the
 * user cannot clear, so it is only ever claimed from a positive statement.
 */
export function deriveCapabilities(model: CatalogModel): ModelCapabilityId[] {
  const present = new Set<ModelCapabilityId>();
  if (model.capabilities?.tools) {
    present.add("tools");
  }
  const reasoning = model.capabilities?.reasoning;
  if (reasoning && reasoning !== "none") {
    present.add("reasoning");
  }
  if (hasModality(model.input_modalities, "image")) {
    present.add("image_in");
  }
  if (hasModality(model.input_modalities, "audio")) {
    present.add("audio_in");
  }
  if (hasModality(model.input_modalities, "video")) {
    present.add("video_in");
  }
  if (hasModality(model.output_modalities, "image")) {
    present.add("image_out");
  }
  if (hasModality(model.output_modalities, "audio")) {
    present.add("audio_out");
  }
  return MODEL_CAPABILITIES.filter((capability) => present.has(capability.id)).map(
    (capability) => capability.id,
  );
}

/**
 * Keep only models carrying every selected capability.
 *
 * Chips narrow rather than rank: a model that does not state a capability is
 * excluded while that chip is active, which is what makes "show me the ones
 * that can read images" a usable filter.
 */
export function filterModelsByCapabilities(
  models: CatalogModel[],
  selected: ModelCapabilityId[],
): CatalogModel[] {
  if (selected.length === 0) {
    return models;
  }
  return models.filter((model) => {
    const capabilities = new Set(deriveCapabilities(model));
    return selected.every((capability) => capabilities.has(capability));
  });
}

/**
 * Which capability chips are worth offering for a catalog.
 *
 * A chip nothing matches is a dead control that only advertises what the
 * user's providers cannot do, so the filter row is built from the catalog in
 * front of the user rather than from the full capability list.
 */
export function availableCapabilities(models: CatalogModel[]): ModelCapabilityId[] {
  const present = new Set<ModelCapabilityId>();
  for (const model of models) {
    for (const capability of deriveCapabilities(model)) {
      present.add(capability);
    }
  }
  return MODEL_CAPABILITIES.filter((capability) => present.has(capability.id)).map(
    (capability) => capability.id,
  );
}
