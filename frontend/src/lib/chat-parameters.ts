import type { ParameterInputKind } from "@/lib/types";

export interface ParameterOption {
  label: string;
  value: string;
}

export interface ParameterDefinitionShape {
  key: string;
  label: string;
  description: string;
  input: ParameterInputKind;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  options?: ParameterOption[];
  rows?: number;
}

export const PARAMETER_DEFINITIONS = [
  {
    key: "temperature",
    label: "Temperature",
    description: "Higher values increase randomness (0-2).",
    input: "number",
    min: 0,
    max: 2,
    step: 0.1,
    placeholder: "1.0",
  },
  {
    key: "top_p",
    label: "Top P",
    description: "Limit tokens to a probability mass.",
    input: "number",
    min: 0,
    max: 1,
    step: 0.05,
    placeholder: "1.0",
  },
  {
    key: "top_k",
    label: "Top K",
    description: "Sample only from the top K tokens.",
    input: "integer",
    min: 0,
    step: 1,
    placeholder: "0 (disabled)",
  },
  {
    key: "min_p",
    label: "Min P",
    description: "Minimum relative probability threshold.",
    input: "number",
    min: 0,
    max: 1,
    step: 0.01,
    placeholder: "0.0",
  },
  {
    key: "top_a",
    label: "Top A",
    description: "Adaptive nucleus setting (0-1).",
    input: "number",
    min: 0,
    max: 1,
    step: 0.01,
    placeholder: "0.0",
  },
  {
    key: "frequency_penalty",
    label: "Frequency penalty",
    description: "Penalize repeated tokens by count.",
    input: "number",
    min: -2,
    max: 2,
    step: 0.1,
    placeholder: "0.0",
  },
  {
    key: "presence_penalty",
    label: "Presence penalty",
    description: "Discourage reusing prior tokens.",
    input: "number",
    min: -2,
    max: 2,
    step: 0.1,
    placeholder: "0.0",
  },
  {
    key: "repetition_penalty",
    label: "Repetition penalty",
    description: "Reduce repeated generations.",
    input: "number",
    min: 0,
    max: 2,
    step: 0.05,
    placeholder: "1.0",
  },
  {
    key: "max_tokens",
    label: "Max tokens",
    description: "Cap on generated tokens.",
    input: "integer",
    min: 1,
    step: 1,
    placeholder: "512",
  },
  {
    key: "reasoning",
    label: "Reasoning effort",
    description:
      "Control how much thinking budget the model should spend when reasoning tokens are available.",
    input: "select",
    options: [
      { label: "Model default", value: "" },
      { label: "Minimal", value: "minimal" },
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
    ],
  },
  {
    key: "seed",
    label: "Seed",
    description: "Deterministic sampling seed.",
    input: "integer",
    min: 0,
    step: 1,
    placeholder: "Leave blank for randomness",
  },
  {
    key: "logprobs",
    label: "Log probabilities",
    description: "Return logprobs for each token.",
    input: "boolean",
  },
  {
    key: "top_logprobs",
    label: "Top logprobs",
    description: "How many alternate tokens to include (0-20).",
    input: "integer",
    min: 0,
    max: 20,
    step: 1,
    placeholder: "5",
  },
  {
    key: "structured_outputs",
    label: "Structured outputs",
    description: "Request JSON schema enforcement.",
    input: "boolean",
  },
  {
    key: "verbosity",
    label: "Verbosity",
    description: "Control response detail level.",
    input: "select",
    options: [
      { label: "Model default", value: "" },
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
    ],
  },
  {
    key: "stop",
    label: "Stop sequences",
    description: "Comma or newline separated stop strings.",
    input: "list",
    placeholder: "###, END",
    rows: 2,
  },
  {
    key: "response_format",
    label: "Response format",
    description: "JSON describing the expected response schema.",
    input: "json",
    placeholder: '{ "type": "json_object" }',
    rows: 3,
  },
  {
    key: "logit_bias",
    label: "Logit bias",
    description: "JSON map of token IDs to bias values.",
    input: "json",
    placeholder: '{ "318": -100 }',
    rows: 3,
  },
  {
    key: "extra_body",
    label: "Additional parameters",
    description:
      "JSON merged into the request body last, for fields not listed above. Keys the server rejects fail with its own error.",
    input: "json",
    placeholder: '{ "service_tier": "flex" }',
    rows: 3,
  },
] as const satisfies readonly ParameterDefinitionShape[];

export type ParameterDefinition = (typeof PARAMETER_DEFINITIONS)[number];
export type ModelParameterKey = ParameterDefinition["key"];
export type ParameterValue = number | string | boolean | Record<string, unknown>;
export type ParameterOverrides = Partial<Record<ModelParameterKey, ParameterValue>>;

/** A definition as rendered for one model — options may be model-specific. */
export type ResolvedParameterDefinition = ParameterDefinitionShape & {
  key: ModelParameterKey;
};

const EFFORT_LABELS: Record<string, string> = { xhigh: "Extra high" };

/**
 * Filter the definitions down to one model's supported set and swap in the
 * model's own reasoning-effort levels where the provider publishes them.
 * `extra_body` is always visible: it exists precisely for parameters the
 * catalog does not know about.
 */
export function resolveParameterDefinitions(
  supportedKeys: ReadonlySet<ModelParameterKey>,
  reasoningEfforts?: readonly string[] | null,
): ResolvedParameterDefinition[] {
  return PARAMETER_DEFINITIONS.filter(
    (definition) => definition.key === "extra_body" || supportedKeys.has(definition.key),
  ).map((definition) => {
    if (definition.key !== "reasoning" || !reasoningEfforts?.length) {
      return definition;
    }
    return {
      ...definition,
      options: [
        { label: "Model default", value: "" },
        ...reasoningEfforts.map((effort) => ({
          label:
            EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1),
          value: effort,
        })),
      ],
    };
  });
}
