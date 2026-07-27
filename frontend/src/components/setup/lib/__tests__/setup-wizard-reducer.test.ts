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

  it("names the collection and launches it as separate steps, in that order", () => {
    // Launch is a terminal beat with no controls, so the collection it creates
    // has to be fully described before the user reaches it.
    expect(SETUP_STEPS.indexOf("collection")).toBeLessThan(SETUP_STEPS.indexOf("launch"));
    expect(SETUP_STEPS.at(-1)).toBe("launch");
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
    expect(state.choices.collectionName).toBe("My first collection");
    expect(state.choices.backend).toBe("pgvector");
  });

  it("suggests an index name only into an untouched field, and only once", () => {
    const suggested = "ragworks-andrew-780c25bf";
    const seeded = setupWizardReducer(start(), {
      type: "SEED_INDEX_NAME",
      name: suggested,
    });
    expect(seeded.choices.indexName).toBe(suggested);

    // A user who clears the box to type their own name keeps an empty box:
    // re-suggesting on the next render would fight them keystroke by keystroke.
    const cleared = setupWizardReducer(seeded, {
      type: "SET_CHOICES",
      choices: { indexName: "" },
    });
    const reseeded = setupWizardReducer(cleared, {
      type: "SEED_INDEX_NAME",
      name: suggested,
    });
    expect(reseeded.choices.indexName).toBe("");
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
