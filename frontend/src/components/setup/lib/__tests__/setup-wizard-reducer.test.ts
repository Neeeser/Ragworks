import { describe, expect, it } from "vitest";

import {
  initialSetupWizardState,
  SETUP_STEPS,
  setupWizardReducer,
} from "@/components/setup/lib/setup-wizard-reducer";

const start = () => initialSetupWizardState("pgvector");

describe("setupWizardReducer", () => {
  it("advances through every step in order and stops at the last", () => {
    let state = start();
    for (const expected of SETUP_STEPS) {
      expect(state.step).toBe(expected);
      state = setupWizardReducer(state, { type: "NEXT" });
    }
    expect(state.step).toBe("launch");
    expect(state.direction).toBe(1);
  });

  it("goes back without falling off the first step", () => {
    let state = setupWizardReducer(start(), { type: "NEXT" });
    state = setupWizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("welcome");
    expect(state.direction).toBe(-1);
    expect(setupWizardReducer(state, { type: "BACK" }).step).toBe("welcome");
  });

  it("merges partial choice updates without clobbering the rest", () => {
    const state = setupWizardReducer(start(), {
      type: "SET_CHOICES",
      choices: { embeddingModel: "m/x", embeddingDimension: 384 },
    });
    expect(state.choices.embeddingModel).toBe("m/x");
    expect(state.choices.embeddingDimension).toBe(384);
    expect(state.choices.indexName).toBe("ragworks");
    expect(state.choices.backend).toBe("pgvector");
  });

  it("seeds model-derived chunk defaults until the user edits them", () => {
    let state = setupWizardReducer(start(), {
      type: "SEED_CHUNK_DEFAULTS",
      chunkSize: 240,
      chunkOverlap: 48,
    });
    expect(state.choices.chunkSize).toBe(240);
    expect(state.choices.chunkOverlap).toBe(48);
    expect(state.chunkDirty).toBe(false);

    // A manual edit pins the values and stops further seeding.
    state = setupWizardReducer(state, { type: "SET_CHUNK", chunkSize: 300 });
    expect(state.choices.chunkSize).toBe(300);
    expect(state.chunkDirty).toBe(true);

    const afterSeed = setupWizardReducer(state, {
      type: "SEED_CHUNK_DEFAULTS",
      chunkSize: 512,
      chunkOverlap: 102,
    });
    expect(afterSeed.choices.chunkSize).toBe(300);
    expect(afterSeed.choices.chunkOverlap).toBe(state.choices.chunkOverlap);
  });
});
