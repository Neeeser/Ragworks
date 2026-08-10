import type { NodePreset, NodeSpec } from "@/lib/types";

/** Drag payload naming the preset riding alongside the node-type MIME. */
export const NODE_PRESET_MIME = "application/ragworks-node-preset";

/**
 * A preset viewed as a spec: same type id and ports, the preset's label and
 * description, and its config merged over the node's defaults. Everything
 * downstream (preview drawer, add-to-canvas, drop) already consumes specs,
 * so presets cost no new plumbing.
 */
export const presetizedSpec = (spec: NodeSpec, preset: NodePreset): NodeSpec => ({
  ...spec,
  label: preset.label,
  description: preset.description,
  default_config: { ...spec.default_config, ...preset.config },
});

/**
 * A named preset's seeded config, read off the node specs. Scaffolds that
 * wire a preset-shaped node (the described-images intake's vision shell) take
 * the prompt and output fields from the registry this way, so they cannot
 * drift from the preset the node library drops.
 */
export const presetConfig = (
  specs: NodeSpec[],
  nodeType: string,
  presetId: string,
): Record<string, unknown> | undefined =>
  specs.find((spec) => spec.type === nodeType)?.presets?.find((preset) => preset.id === presetId)
    ?.config;

/** Resolve a dragged preset id against its spec; unknown ids fall back to the spec. */
export const resolveDraggedSpec = (spec: NodeSpec, presetId: string): NodeSpec => {
  const preset = spec.presets?.find((entry) => entry.id === presetId);
  return preset ? presetizedSpec(spec, preset) : spec;
};
