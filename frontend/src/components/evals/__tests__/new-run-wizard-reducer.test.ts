import { describe, expect, it } from "vitest";

import { initialWizardState, wizardReducer } from "@/components/evals/lib/new-run-wizard-reducer";

describe("wizardReducer", () => {
  it("clears bound run inputs when the retrieval pipeline changes", () => {
    let state = wizardReducer(initialWizardState, {
      type: "select_retrieval",
      pipelineId: "ret-1",
    });
    state = wizardReducer(state, { type: "set_run_input", name: "top_k", value: "25" });
    expect(state.runInputs).toEqual({ top_k: "25" });

    state = wizardReducer(state, { type: "select_retrieval", pipelineId: "ret-2" });
    expect(state.retrievalId).toBe("ret-2");
    // ret-2 declares its own variables; ret-1's bound values must not leak in.
    expect(state.runInputs).toEqual({});
  });

  it("launch_failed clears busy and records the message for a retry", () => {
    let state = wizardReducer(initialWizardState, { type: "launch_started" });
    expect(state.busy).toBe(true);
    expect(state.message).toBeNull();
    state = wizardReducer(state, { type: "launch_failed", message: "Could not start" });
    expect(state.busy).toBe(false);
    expect(state.message).toBe("Could not start");
    // The next attempt clears the stale error at its start.
    state = wizardReducer(state, { type: "launch_started" });
    expect(state.message).toBeNull();
  });

  it("toggles k cutoffs keeping them sorted", () => {
    let state = { ...initialWizardState, kSelected: [5, 10] };
    state = wizardReducer(state, { type: "toggle_k", k: 1 });
    expect(state.kSelected).toEqual([1, 5, 10]);
    state = wizardReducer(state, { type: "toggle_k", k: 5 });
    expect(state.kSelected).toEqual([1, 10]);
  });
});
