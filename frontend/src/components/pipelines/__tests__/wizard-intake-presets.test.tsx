import { describe, expect, it } from "vitest";

import { buildIngestionDefinition } from "@/components/pipelines/lib/pipeline-scaffold";
import { INTAKE_PRESETS } from "@/components/pipelines/WizardIntakePresets";

import type { IntakeMode } from "@/components/pipelines/lib/pipeline-scaffold";

const IMAGES_MODE: IntakeMode = "images";

const wiredNodeNames = (intake: IntakeMode): string[] =>
  buildIngestionDefinition("pgvector", { intake }).nodes.map((node) => node.name);

describe("INTAKE_PRESETS", () => {
  it("names only nodes the scaffold wires for that mode", () => {
    for (const preset of INTAKE_PRESETS) {
      const wired = wiredNodeNames(preset.id);
      for (const name of preset.nodes.split(" · ")) {
        expect(wired).toContain(name);
      }
    }
  });

  it("says what the images preset does to an image, not only which node does it", () => {
    const images = INTAKE_PRESETS.find((preset) => preset.id === IMAGES_MODE);
    expect(images?.nodes).toContain("Resize Images");
    expect(images?.hint).toMatch(/resized to fit/);
  });
});
