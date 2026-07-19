/** Pure state for the new-run wizard: one reducer instead of 14 useStates. */

import { DEFAULT_CONCURRENCY, DEFAULT_SELECTED_K } from "@/components/evals/lib/run-config";

export interface WizardState {
  step: number;
  datasetId: string;
  ingestionId: string;
  retrievalId: string;
  preset: string;
  advancedOpen: boolean;
  numQueries: string;
  distractors: string;
  seed: string;
  concurrency: number;
  kSelected: number[];
  runInputs: Record<string, string>;
  busy: boolean;
  message: string | null;
}

export const initialWizardState: WizardState = {
  step: 0,
  datasetId: "",
  ingestionId: "",
  retrievalId: "",
  preset: "quick",
  advancedOpen: false,
  numQueries: "",
  distractors: "",
  seed: "0",
  concurrency: DEFAULT_CONCURRENCY,
  kSelected: [...DEFAULT_SELECTED_K],
  runInputs: {},
  busy: false,
  message: null,
};

export type WizardAction =
  | { type: "set_step"; step: number }
  | { type: "back" }
  | { type: "select_dataset"; datasetId: string }
  | { type: "select_ingestion"; pipelineId: string }
  | { type: "select_retrieval"; pipelineId: string }
  | { type: "set_preset"; preset: string }
  | { type: "toggle_advanced" }
  | { type: "set_field"; field: "numQueries" | "distractors" | "seed"; value: string }
  | { type: "set_concurrency"; value: number }
  | { type: "toggle_k"; k: number }
  | { type: "set_run_input"; name: string; value: string }
  | { type: "launch_started" }
  | { type: "launch_failed"; message: string };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "set_step":
      return { ...state, step: action.step };
    case "back":
      return { ...state, step: Math.max(0, state.step - 1) };
    case "select_dataset":
      return { ...state, datasetId: action.datasetId };
    case "select_ingestion":
      return { ...state, ingestionId: action.pipelineId };
    case "select_retrieval":
      // A different pipeline declares different variables; carrying the old
      // bound values over would silently feed them to the new pipeline.
      return { ...state, retrievalId: action.pipelineId, runInputs: {} };
    case "set_preset":
      return { ...state, preset: action.preset };
    case "toggle_advanced":
      return { ...state, advancedOpen: !state.advancedOpen };
    case "set_field":
      return { ...state, [action.field]: action.value };
    case "set_concurrency":
      return { ...state, concurrency: action.value };
    case "toggle_k":
      return {
        ...state,
        kSelected: state.kSelected.includes(action.k)
          ? state.kSelected.filter((value) => value !== action.k)
          : [...state.kSelected, action.k].sort((a, b) => a - b),
      };
    case "set_run_input":
      return { ...state, runInputs: { ...state.runInputs, [action.name]: action.value } };
    case "launch_started":
      return { ...state, busy: true, message: null };
    case "launch_failed":
      return { ...state, busy: false, message: action.message };
  }
}
