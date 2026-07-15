import type { IndexBackend } from "@/lib/types";

/** Ordered wizard steps; `welcome` is always first, `launch` always last. */
export const SETUP_STEPS = ["welcome", "providers", "model", "index", "launch"] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

/** Preferred first-run model: small, stable, fits every backend's caps. */
export const SUGGESTED_MODEL_FRAGMENT = "all-minilm-l6";

export interface SetupChoices {
  embeddingConnectionId: string | null;
  embeddingModel: string;
  embeddingDimension: number | null;
  backend: IndexBackend;
  indexName: string;
  collectionName: string;
  chunkSize: number;
  chunkOverlap: number;
}

export interface SetupWizardState {
  step: SetupStepId;
  /** +1 when advancing, -1 when going back — drives the slide transition. */
  direction: 1 | -1;
  choices: SetupChoices;
}

export type SetupWizardAction =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SET_CHOICES"; choices: Partial<SetupChoices> };

export const initialSetupWizardState = (backend: IndexBackend): SetupWizardState => ({
  step: "welcome",
  direction: 1,
  choices: {
    embeddingConnectionId: null,
    embeddingModel: "",
    embeddingDimension: null,
    backend,
    indexName: "ragworks",
    collectionName: "My first collection",
    chunkSize: 512,
    chunkOverlap: 200,
  },
});

export function setupWizardReducer(
  state: SetupWizardState,
  action: SetupWizardAction,
): SetupWizardState {
  switch (action.type) {
    case "NEXT": {
      const index = SETUP_STEPS.indexOf(state.step);
      if (index >= SETUP_STEPS.length - 1) return state;
      return { ...state, step: SETUP_STEPS[index + 1], direction: 1 };
    }
    case "BACK": {
      const index = SETUP_STEPS.indexOf(state.step);
      if (index <= 0) return state;
      return { ...state, step: SETUP_STEPS[index - 1], direction: -1 };
    }
    case "SET_CHOICES":
      return { ...state, choices: { ...state.choices, ...action.choices } };
    default:
      return state;
  }
}
