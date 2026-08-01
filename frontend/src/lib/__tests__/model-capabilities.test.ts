import { describe, expect, it } from "vitest";

import {
  availableCapabilities,
  deriveCapabilities,
  filterModelsByCapabilities,
} from "@/lib/model-capabilities";
import { makeCatalogModel } from "@/test/fixtures";

describe("deriveCapabilities", () => {
  it("never badges text — it is the baseline every model serves", () => {
    const model = makeCatalogModel({
      input_modalities: ["text"],
      output_modalities: ["text"],
      capabilities: { tools: false, reasoning: "none", reasoning_efforts: [], sampling: "always" },
    });

    expect(deriveCapabilities(model)).toEqual([]);
  });

  it("claims a modality only from the provider's own statement", () => {
    const vision = makeCatalogModel({
      input_modalities: ["text", "image", "audio"],
      output_modalities: ["text", "image"],
      capabilities: { tools: true, reasoning: "block", reasoning_efforts: [], sampling: "always" },
    });

    expect(deriveCapabilities(vision)).toEqual([
      "tools",
      "reasoning",
      "image_in",
      "audio_in",
      "image_out",
    ]);
  });

  it("treats a provider that publishes nothing as stating nothing", () => {
    // Absence must read as "not stated", never as "cannot" — otherwise a
    // provider with no capability tree renders as less capable than one with.
    const bare = makeCatalogModel({
      input_modalities: [],
      output_modalities: [],
      capabilities: undefined,
    });

    expect(deriveCapabilities(bare)).toEqual([]);
  });

  it("does not claim reasoning from a model that names no style", () => {
    const model = makeCatalogModel({
      capabilities: { tools: false, reasoning: "none", reasoning_efforts: [], sampling: "always" },
    });

    expect(deriveCapabilities(model)).toEqual([]);
  });
});

describe("filterModelsByCapabilities", () => {
  const textOnly = makeCatalogModel({
    id: "text-only",
    capabilities: { tools: false, reasoning: "none", reasoning_efforts: [], sampling: "always" },
  });
  const visionTools = makeCatalogModel({
    id: "vision-tools",
    input_modalities: ["text", "image"],
    capabilities: { tools: true, reasoning: "none", reasoning_efforts: [], sampling: "always" },
  });

  it("returns everything when nothing is selected", () => {
    expect(filterModelsByCapabilities([textOnly, visionTools], [])).toHaveLength(2);
  });

  it("requires every selected capability, not any of them", () => {
    expect(
      filterModelsByCapabilities([textOnly, visionTools], ["tools", "image_in"]).map((m) => m.id),
    ).toEqual(["vision-tools"]);
    expect(filterModelsByCapabilities([textOnly, visionTools], ["tools", "audio_in"])).toEqual([]);
  });
});

describe("availableCapabilities", () => {
  it("offers only chips the catalog can actually match", () => {
    const models = [
      makeCatalogModel({
        id: "a",
        capabilities: { tools: true, reasoning: "none", reasoning_efforts: [], sampling: "always" },
      }),
      makeCatalogModel({ id: "b", input_modalities: ["text", "image"] }),
    ];

    // No model here takes audio, so an "Audio input" chip would be a dead
    // control advertising something no connected provider serves.
    expect(availableCapabilities(models)).toEqual(["tools", "image_in"]);
  });
});
