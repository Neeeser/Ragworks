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
  /** Opt-in aggregate tools scaffolded alongside the default search tool. */
  addCountTool: boolean;
  addFacetTool: boolean;
  /** Add a reranker to the search tool; requires a reranking connection. */
  addReranker: boolean;
  rerankerConnectionId: string | null;
  rerankerModel: string;
}

export interface SetupWizardState {
  step: SetupStepId;
  /** +1 when advancing, -1 when going back — drives the slide transition. */
  direction: 1 | -1;
  choices: SetupChoices;
  /**
   * True once the user has manually edited chunk size or overlap. Model-derived
   * defaults stop seeding after this, so picking a model never clobbers a value
   * the user typed.
   */
  chunkDirty: boolean;
}

export type SetupWizardAction =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SET_CHOICES"; choices: Partial<SetupChoices> }
  | { type: "SET_CHUNK"; chunkSize?: number; chunkOverlap?: number }
  | { type: "SEED_CHUNK_DEFAULTS"; chunkSize: number; chunkOverlap: number };

export const initialSetupWizardState = (backend: IndexBackend): SetupWizardState => ({
  step: "welcome",
  direction: 1,
  chunkDirty: false,
  choices: {
    embeddingConnectionId: null,
    embeddingModel: "",
    embeddingDimension: null,
    backend,
    indexName: "ragworks",
    collectionName: "My first collection",
    // Seeded from the selected model's window before the launch step; these are
    // the unknown-model fallback (see `chunkDefaultsFor`).
    chunkSize: 512,
    chunkOverlap: 102,
    // Aggregate tools default on (they only render when the backend supports
    // them); the reranker is opt-in since it needs a reranking connection.
    addCountTool: true,
    addFacetTool: true,
    addReranker: false,
    rerankerConnectionId: null,
    rerankerModel: "",
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
    case "SET_CHUNK": {
      // A manual edit pins the values: model-derived seeding stops from here.
      const patch: Partial<SetupChoices> = {};
      if (action.chunkSize !== undefined) patch.chunkSize = action.chunkSize;
      if (action.chunkOverlap !== undefined) patch.chunkOverlap = action.chunkOverlap;
      return { ...state, chunkDirty: true, choices: { ...state.choices, ...patch } };
    }
    case "SEED_CHUNK_DEFAULTS": {
      // Model-derived defaults never overwrite a value the user typed.
      if (state.chunkDirty) return state;
      return {
        ...state,
        choices: {
          ...state.choices,
          chunkSize: action.chunkSize,
          chunkOverlap: action.chunkOverlap,
        },
      };
    }
    default:
      return state;
  }
}
