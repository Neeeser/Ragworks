/**
 * State for the generate-dataset wizard: source collection, generation models,
 * and question shaping. Pure module — no React imports — so transitions are
 * unit-testable.
 */

import { EVAL_MODALITIES } from "@/components/evals/lib/modalities";

import type {
  CatalogModel,
  EvalDatasetGeneratePayload,
  EvalModality,
  EvalQuestionType,
  GenerationModelChoice,
} from "@/lib/types";

/**
 * Generation calls enforce their output shape through the provider's
 * structured-outputs feature, so the wizard only offers models that
 * advertise support for it.
 */
export function supportsStructuredOutputs(model: CatalogModel): boolean {
  return (model.supported_parameters || []).some((parameter) => {
    const normalized = parameter.toLowerCase();
    return normalized === "structured_outputs" || normalized === "response_format";
  });
}

export interface CountPreset {
  key: string;
  count: number;
}

/**
 * How many questions to generate — a single-axis choice, so the count is the
 * whole of it and each preset is labelled by its own number.
 *
 * The abstract sizes these once carried collided with the run wizard's own
 * Quick/Standard presets, where the same word means a different number in the
 * same feature; a reader comparing the two screens has no way to tell that
 * "Quick" is 20 questions here and 50 queries there.
 */
export const COUNT_PRESETS: CountPreset[] = [
  { key: "quick", count: 20 },
  { key: "standard", count: 50 },
  { key: "deep", count: 100 },
];

/** Default question-type shares, mirroring `DEFAULT_QUESTION_TYPE_MIX`. */
export const DEFAULT_TYPE_SHARES: Record<EvalQuestionType, number> = {
  single_fact: 50,
  paraphrased: 25,
  multi_detail: 25,
};

export interface GenerateWizardState {
  step: number;
  name: string;
  /** Set once the user edits the name; auto-naming then stops following the source. */
  nameTouched: boolean;
  collectionId: string;
  /**
   * `${connection_id}::${model_id}` — one value qualifying model by connection.
   * Applies to every modality unless `perModality` is on, where it stays the
   * text model.
   */
  modelKey: string;
  /** Whether each modality picks its own model instead of sharing `modelKey`. */
  perModality: boolean;
  /** Per-modality overrides; a modality with no entry falls back to `modelKey`. */
  modalityModelKeys: Partial<Record<EvalModality, string>>;
  preset: string;
  countOverride: string;
  /** The optional steering section (audience + example queries), collapsed by default. */
  steeringOpen: boolean;
  advancedOpen: boolean;
  typeShares: Record<EvalQuestionType, number>;
  audience: string;
  /** Real queries whose style generated questions imitate. Any number; blanks are dropped. */
  exampleQueries: string[];
  seed: string;
  busy: boolean;
  message: string | null;
}

export const initialGenerateWizardState: GenerateWizardState = {
  step: 0,
  name: "",
  nameTouched: false,
  collectionId: "",
  modelKey: "",
  perModality: false,
  modalityModelKeys: {},
  preset: "standard",
  countOverride: "",
  steeringOpen: false,
  advancedOpen: false,
  typeShares: { ...DEFAULT_TYPE_SHARES },
  audience: "",
  exampleQueries: [""],
  seed: "0",
  busy: false,
  message: null,
};

export type GenerateWizardAction =
  | { type: "set_step"; step: number }
  | { type: "back" }
  | { type: "select_collection"; collectionId: string; collectionName: string }
  | { type: "set_name"; name: string }
  | { type: "select_model"; modelKey: string }
  | { type: "toggle_per_modality" }
  | { type: "select_modality_model"; modality: EvalModality; modelKey: string }
  | { type: "set_preset"; preset: string }
  | { type: "set_count_override"; value: string }
  | { type: "toggle_steering" }
  | { type: "toggle_advanced" }
  | { type: "set_type_share"; questionType: EvalQuestionType; value: number }
  | { type: "set_audience"; audience: string }
  | { type: "set_example_query"; index: number; value: string }
  | { type: "add_example_query" }
  | { type: "remove_example_query"; index: number }
  | { type: "set_seed"; seed: string }
  | { type: "launch_started" }
  | { type: "launch_failed"; message: string };

export function generateWizardReducer(
  state: GenerateWizardState,
  action: GenerateWizardAction,
): GenerateWizardState {
  switch (action.type) {
    case "set_step":
      return { ...state, step: action.step, message: null };
    case "back":
      return { ...state, step: Math.max(0, state.step - 1), message: null };
    case "select_collection":
      return {
        ...state,
        collectionId: action.collectionId,
        // A name the user typed is theirs; only the default follows the source.
        name: state.nameTouched ? state.name : `${action.collectionName} eval set`,
      };
    case "set_name":
      return { ...state, name: action.name, nameTouched: true };
    case "select_model":
      return { ...state, modelKey: action.modelKey };
    case "toggle_per_modality":
      // Overrides are kept across a toggle: unchecking the box to compare the
      // shared model and rechecking it must not discard the image model the
      // user already picked.
      return { ...state, perModality: !state.perModality };
    case "select_modality_model":
      return {
        ...state,
        modalityModelKeys: { ...state.modalityModelKeys, [action.modality]: action.modelKey },
      };
    case "set_preset":
      return { ...state, preset: action.preset, countOverride: "" };
    case "set_count_override":
      return { ...state, countOverride: action.value };
    case "toggle_steering":
      return { ...state, steeringOpen: !state.steeringOpen };
    case "toggle_advanced":
      return { ...state, advancedOpen: !state.advancedOpen };
    case "set_type_share":
      return {
        ...state,
        typeShares: { ...state.typeShares, [action.questionType]: action.value },
      };
    case "set_audience":
      return { ...state, audience: action.audience };
    case "set_example_query":
      return {
        ...state,
        exampleQueries: state.exampleQueries.map((entry, index) =>
          index === action.index ? action.value : entry,
        ),
      };
    case "add_example_query":
      return { ...state, exampleQueries: [...state.exampleQueries, ""] };
    case "remove_example_query":
      return {
        ...state,
        exampleQueries: state.exampleQueries.filter((_, index) => index !== action.index),
      };
    case "set_seed":
      return { ...state, seed: action.seed };
    case "launch_started":
      return { ...state, busy: true, message: null };
    case "launch_failed":
      return { ...state, busy: false, message: action.message };
  }
}

export function resolvedQuestionCount(state: GenerateWizardState): number {
  const override = Number(state.countOverride);
  if (state.countOverride.trim() !== "" && Number.isInteger(override) && override > 0) {
    return Math.min(override, 500);
  }
  const preset = COUNT_PRESETS.find((entry) => entry.key === state.preset);
  return preset?.count ?? 50;
}

/** True when every type share is zero — an unusable mix the UI must block. */
export function mixIsEmpty(shares: Record<EvalQuestionType, number>): boolean {
  return Object.values(shares).every((share) => share <= 0);
}

/**
 * The `${connection_id}::${model_id}` key one modality generates with.
 *
 * Text always reads the shared picker — it is the model every dataset needs,
 * so a separate text override would be the same choice under two controls. A
 * modality with no override of its own falls back to the shared key, which is
 * what makes the checkbox reveal pickers that already hold a valid selection.
 */
export function modalityModelKey(state: GenerateWizardState, modality: EvalModality): string {
  if (!state.perModality || modality === "text") {
    return state.modelKey;
  }
  return state.modalityModelKeys[modality] || state.modelKey;
}

/** Split a `${connection_id}::${model_id}` key back into its parts. */
export function splitModelKey(modelKey: string): { connectionId: string; modelName: string } {
  const [connectionId, ...rest] = modelKey.split("::");
  return { connectionId: connectionId ?? "", modelName: rest.join("::") };
}

export function buildGeneratePayload(state: GenerateWizardState): EvalDatasetGeneratePayload {
  const examples = state.exampleQueries.map((entry) => entry.trim()).filter(Boolean);
  const shares = Object.fromEntries(
    Object.entries(state.typeShares).filter(([, share]) => share > 0),
  ) as Partial<Record<EvalQuestionType, number>>;
  // Every modality is sent, including the ones sharing the default model, so
  // the backend reads one request shape whether or not the user split them.
  const models = Object.fromEntries(
    EVAL_MODALITIES.map((modality) => {
      const { connectionId, modelName } = splitModelKey(modalityModelKey(state, modality));
      return [modality, { connection_id: connectionId, model_name: modelName }];
    }),
  ) as Record<EvalModality, GenerationModelChoice>;
  return {
    name: state.name.trim(),
    collection_id: state.collectionId,
    models,
    num_questions: resolvedQuestionCount(state),
    type_mix: shares,
    audience: state.audience.trim() || null,
    example_queries: examples,
    seed: Number(state.seed) || 0,
  };
}
