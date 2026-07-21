import { describe, expect, it } from "vitest";

import {
  buildGeneratePayload,
  generateWizardReducer,
  initialGenerateWizardState,
  mixIsEmpty,
  resolvedQuestionCount,
  supportsStructuredOutputs,
} from "@/components/evals/lib/generate-dataset-wizard-reducer";
import { makeCatalogModel } from "@/test/fixtures";

import type {
  GenerateWizardAction,
  GenerateWizardState,
} from "@/components/evals/lib/generate-dataset-wizard-reducer";

function reduce(actions: GenerateWizardAction[]): GenerateWizardState {
  return actions.reduce(generateWizardReducer, initialGenerateWizardState);
}

describe("generate-dataset wizard reducer", () => {
  it("auto-names the dataset from the collection until the user edits the name", () => {
    const named = reduce([
      { type: "select_collection", collectionId: "c1", collectionName: "Papers" },
    ]);
    expect(named.name).toBe("Papers eval set");

    const renamed = reduce([
      { type: "select_collection", collectionId: "c1", collectionName: "Papers" },
      { type: "set_name", name: "My set" },
      { type: "select_collection", collectionId: "c2", collectionName: "Notes" },
    ]);
    expect(renamed.name).toBe("My set");
  });

  it("resolves the question count from preset, override, and the 500 cap", () => {
    expect(resolvedQuestionCount(initialGenerateWizardState)).toBe(50);
    expect(resolvedQuestionCount(reduce([{ type: "set_preset", preset: "deep" }]))).toBe(100);
    expect(resolvedQuestionCount(reduce([{ type: "set_count_override", value: "7" }]))).toBe(7);
    expect(resolvedQuestionCount(reduce([{ type: "set_count_override", value: "9999" }]))).toBe(
      500,
    );
    // A non-numeric override falls back to the preset.
    expect(resolvedQuestionCount(reduce([{ type: "set_count_override", value: "abc" }]))).toBe(50);
  });

  it("selecting a preset clears a stale count override", () => {
    const state = reduce([
      { type: "set_count_override", value: "7" },
      { type: "set_preset", preset: "quick" },
    ]);
    expect(state.countOverride).toBe("");
    expect(resolvedQuestionCount(state)).toBe(20);
  });

  it("flags an all-zero type mix as unusable", () => {
    const state = reduce([
      { type: "set_type_share", questionType: "single_fact", value: 0 },
      { type: "set_type_share", questionType: "paraphrased", value: 0 },
      { type: "set_type_share", questionType: "multi_detail", value: 0 },
    ]);
    expect(mixIsEmpty(state.typeShares)).toBe(true);
    expect(mixIsEmpty(initialGenerateWizardState.typeShares)).toBe(false);
  });

  it("builds the wire payload: model key split, trimmed examples, zero types dropped", () => {
    const state = reduce([
      { type: "select_collection", collectionId: "c1", collectionName: "Papers" },
      { type: "select_model", modelKey: "conn-1::openai/gpt-4o-mini" },
      { type: "set_audience", audience: "  support engineers  " },
      { type: "set_example_query", index: 0, value: " why does upload fail? " },
      { type: "set_example_query", index: 2, value: "   " },
      { type: "set_type_share", questionType: "multi_detail", value: 0 },
      { type: "set_seed", seed: "42" },
    ]);
    const payload = buildGeneratePayload(state);
    expect(payload).toEqual({
      name: "Papers eval set",
      collection_id: "c1",
      connection_id: "conn-1",
      model_name: "openai/gpt-4o-mini",
      num_questions: 50,
      type_mix: { single_fact: 50, paraphrased: 25 },
      audience: "support engineers",
      example_queries: ["why does upload fail?"],
      seed: 42,
    });
  });

  it("a launch failure clears busy and surfaces the message", () => {
    const state = reduce([
      { type: "launch_started" },
      { type: "launch_failed", message: "Could not start" },
    ]);
    expect(state.busy).toBe(false);
    expect(state.message).toBe("Could not start");
  });
});

describe("supportsStructuredOutputs", () => {
  it("keeps models advertising structured_outputs or response_format", () => {
    expect(
      supportsStructuredOutputs(
        makeCatalogModel({ supported_parameters: ["temperature", "structured_outputs"] }),
      ),
    ).toBe(true);
    expect(
      supportsStructuredOutputs(makeCatalogModel({ supported_parameters: ["RESPONSE_FORMAT"] })),
    ).toBe(true);
  });

  it("drops models without structured-output support", () => {
    expect(
      supportsStructuredOutputs(
        makeCatalogModel({ supported_parameters: ["temperature", "tools"] }),
      ),
    ).toBe(false);
    expect(supportsStructuredOutputs(makeCatalogModel({ supported_parameters: [] }))).toBe(false);
  });
});
