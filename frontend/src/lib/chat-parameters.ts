import type { ChatCapabilities, ParameterInputKind } from "@/lib/types";

/** A model whose provider published nothing: no capability may be assumed. */
export const DEFAULT_CAPABILITIES: ChatCapabilities = {
  tools: false,
  reasoning: "none",
  reasoning_efforts: [],
  // Knobs stay offered when unmeasured: the provider's error names any it
  // rejects, where hiding one the model accepts is unrecoverable.
  sampling: "always",
};

/** Knobs a model rejects while it is reasoning, verified to move together. */
export const SAMPLING_KNOBS = ["temperature", "top_p", "top_logprobs"] as const;

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

const MODEL_DEFAULT_OPTION = { label: "Model default", value: "" } as const;

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
      MODEL_DEFAULT_OPTION,
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
      MODEL_DEFAULT_OPTION,
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
  /** Set when the model takes this knob, but not on this turn. */
  unavailableReason?: string;
};

/** True when this turn asks the model to reason, so knobs are refused. */
export function reasoningIsActive(
  capabilities: ChatCapabilities,
  selectedEffort: unknown,
): boolean {
  if (capabilities.reasoning === "none") return false;
  if (typeof selectedEffort === "boolean") return selectedEffort;
  if (typeof selectedEffort === "string" && selectedEffort) return selectedEffort !== "none";
  // Nothing chosen: the backend sends `none` when the model publishes it, and
  // otherwise leaves the model on its own default — which is to reason.
  return !capabilities.reasoning_efforts.includes("none");
}

const EFFORT_LABELS: Record<string, string> = { xhigh: "Extra high" };

const effortOption = (effort: string) => ({
  label: EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1),
  value: effort,
});

/** The reasoning control for a model, or null when it cannot reason. */
function reasoningDefinition(
  definition: ResolvedParameterDefinition,
  capabilities: ChatCapabilities,
): ResolvedParameterDefinition | null {
  if (capabilities.reasoning === "none") return null;
  const efforts = capabilities.reasoning_efforts;
  if (!efforts.length) {
    // The provider takes no effort level (Anthropic's budget-thinking models,
    // Ollama's `think`), so the only honest control is on/off.
    return {
      ...definition,
      label: "Extended thinking",
      description: "Let the model reason before answering.",
      input: "boolean",
      options: undefined,
    };
  }
  return { ...definition, options: [MODEL_DEFAULT_OPTION, ...efforts.map(effortOption)] };
}

/**
 * Filter the definitions down to what this model actually offers: its own
 * sampling knobs, plus a reasoning control shaped by what the provider
 * published about it. `extra_body` is always visible — it exists precisely
 * for parameters no catalog knows about.
 */
export function resolveParameterDefinitions(
  supportedKeys: ReadonlySet<ModelParameterKey>,
  capabilities: ChatCapabilities = DEFAULT_CAPABILITIES,
  selectedEffort?: unknown,
): ResolvedParameterDefinition[] {
  const samplingBlocked =
    capabilities.sampling === "without_reasoning" &&
    reasoningIsActive(capabilities, selectedEffort);
  const resolved: ResolvedParameterDefinition[] = [];
  for (const definition of PARAMETER_DEFINITIONS) {
    if (definition.key === "reasoning") {
      const reasoning = reasoningDefinition(definition, capabilities);
      if (reasoning) resolved.push(reasoning);
      continue;
    }
    const isSamplingKnob = (SAMPLING_KNOBS as readonly string[]).includes(definition.key);
    if (isSamplingKnob && capabilities.sampling === "never") {
      // The model rejects these on every turn, so a control for them is one
      // the user can only ever get an error from.
      continue;
    }
    if (definition.key === "extra_body" || supportedKeys.has(definition.key)) {
      resolved.push(
        isSamplingKnob && samplingBlocked
          ? {
              ...definition,
              unavailableReason: "Unavailable while reasoning is active.",
            }
          : definition,
      );
    }
  }
  return resolved;
}

/** Drop knobs this model refuses on this turn, so none is sent to be rejected. */
export function pruneBlockedSamplingKnobs(
  overrides: ParameterOverrides,
  capabilities: ChatCapabilities | undefined,
): ParameterOverrides {
  if (!capabilities || capabilities.sampling === "always") return overrides;
  const blocked =
    capabilities.sampling === "never" || reasoningIsActive(capabilities, overrides.reasoning);
  if (!blocked) return overrides;
  const next = { ...overrides };
  for (const knob of SAMPLING_KNOBS) delete next[knob];
  return next;
}

/**
 * Drop a stored reasoning effort the target model does not publish.
 *
 * Effort domains are per-model, so switching models can strand a value: the
 * select renders blank (no matching option) while the stale value is still
 * sent, and the provider rejects a level the user cannot see is set.
 */
export function pruneUnsupportedEffort(
  overrides: ParameterOverrides,
  capabilities: ChatCapabilities | undefined,
): ParameterOverrides {
  const stored = overrides.reasoning;
  if (typeof stored !== "string" || !stored) return overrides;
  const efforts = capabilities?.reasoning_efforts ?? [];
  if (!efforts.length || efforts.includes(stored)) return overrides;
  const next = { ...overrides };
  delete next.reasoning;
  return next;
}
