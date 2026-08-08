/**
 * The caller-supplied variables a draft run has to be given values for, and
 * how the panel's text inputs become the request's `arguments`.
 *
 * The panel holds every value as a string because that is what an input
 * element carries; the declared type decides what the backend receives, so a
 * pipeline declaring `integer` is not handed `"3"` and refused.
 */

import type { PipelineVariable } from "@/lib/types";

/** The argument the request's own `top_k` field feeds, so the panel does not
 * ask for it twice. */
const TOP_K_ARGUMENT = "result_limit";

/**
 * The variables the run panel must collect: the ones a caller supplies.
 *
 * A `value` variable is a constant the definition carries and an `expression`
 * one computes itself, so asking for either would offer a control that
 * changes nothing.
 */
export function callerSuppliedVariables(variables: PipelineVariable[]): PipelineVariable[] {
  return variables.filter(
    (variable) =>
      (variable.source ?? "input") === "input" &&
      !variable.expression &&
      variable.name !== TOP_K_ARGUMENT,
  );
}

/** The value the panel starts a variable at: its declared default, or empty. */
export function initialArgumentValue(variable: PipelineVariable): string {
  if (variable.value === null || variable.value === undefined) return "";
  return String(variable.value);
}

/**
 * Coerce the panel's strings into the request's `arguments`.
 *
 * A blank value is omitted rather than sent as `""`: the pipeline's own
 * default should stand, and an empty string is a real value for a string
 * variable that has one.
 */
export function toRunArguments(
  variables: PipelineVariable[],
  values: Record<string, string>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const variable of variables) {
    const raw = values[variable.name];
    if (raw === undefined || raw.trim() === "") continue;
    args[variable.name] = coerce(variable, raw);
  }
  return args;
}

function coerce(variable: PipelineVariable, raw: string): unknown {
  if (variable.type === "boolean") return raw === "true";
  if (variable.type === "integer" || variable.type === "number") {
    const parsed = Number(raw);
    // A value the user is still typing ("1e", "-") is left as typed so the
    // backend reports it against the argument rather than sending NaN.
    return Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}
