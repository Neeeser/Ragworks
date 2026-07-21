/**
 * State for the generate-dataset wizard: source collection, generation model,
 * and question shaping. Pure module — no React imports — so transitions are
 * unit-testable.
 */

import type { CatalogModel, EvalDatasetGeneratePayload, EvalQuestionType } from "@/lib/types";

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
  label: string;
  count: number;
}

export const COUNT_PRESETS: CountPreset[] = [
  { key: "quick", label: "Quick", count: 20 },
  { key: "standard", label: "Standard", count: 50 },
  { key: "deep", label: "Deep", count: 100 },
];

/** Default question-type shares, mirroring `DEFAULT_QUESTION_TYPE_MIX`. */
export const DEFAULT_TYPE_SHARES: Record<EvalQuestionType, number> = {
  single_fact: 50,
  paraphrased: 25,
  multi_detail: 25,
};

export const MAX_EXAMPLE_QUERIES = 3;

export interface GenerateWizardState {
  step: number;
  name: string;
  /** Set once the user edits the name; auto-naming then stops following the source. */
  nameTouched: boolean;
  collectionId: string;
  /** `${connection_id}::${model_id}` — one value qualifying model by connection. */
  modelKey: string;
  preset: string;
  countOverride: string;
  advancedOpen: boolean;
  typeShares: Record<EvalQuestionType, number>;
  audience: string;
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
  preset: "standard",
  countOverride: "",
  advancedOpen: false,
  typeShares: { ...DEFAULT_TYPE_SHARES },
  audience: "",
  exampleQueries: ["", "", ""],
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
  | { type: "set_preset"; preset: string }
  | { type: "set_count_override"; value: string }
  | { type: "toggle_advanced" }
  | { type: "set_type_share"; questionType: EvalQuestionType; value: number }
  | { type: "set_audience"; audience: string }
  | { type: "set_example_query"; index: number; value: string }
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
    case "set_preset":
      return { ...state, preset: action.preset, countOverride: "" };
    case "set_count_override":
      return { ...state, countOverride: action.value };
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

export function buildGeneratePayload(state: GenerateWizardState): EvalDatasetGeneratePayload {
  const [connectionId, ...modelParts] = state.modelKey.split("::");
  const examples = state.exampleQueries.map((entry) => entry.trim()).filter(Boolean);
  const shares = Object.fromEntries(
    Object.entries(state.typeShares).filter(([, share]) => share > 0),
  ) as Partial<Record<EvalQuestionType, number>>;
  return {
    name: state.name.trim(),
    collection_id: state.collectionId,
    connection_id: connectionId,
    model_name: modelParts.join("::"),
    num_questions: resolvedQuestionCount(state),
    type_mix: shares,
    audience: state.audience.trim() || null,
    example_queries: examples.slice(0, MAX_EXAMPLE_QUERIES),
    seed: Number(state.seed) || 0,
  };
}
