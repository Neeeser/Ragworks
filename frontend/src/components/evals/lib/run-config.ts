/** Pure helpers for shaping an eval run's configuration in the wizard. */

import type { PipelineDefinition, PipelineVariable } from "@/lib/types";

/** Cutoffs offered as toggle chips; metrics compute at each selected k. */
export const K_CHOICES: readonly number[] = [1, 3, 5, 10, 20, 25, 50, 100];

export const DEFAULT_SELECTED_K: readonly number[] = [1, 5, 10, 25];

/** Worker-pool sizes offered for parallel retrieval/ingestion. */
export const CONCURRENCY_CHOICES: readonly number[] = [1, 2, 4, 8];

export const DEFAULT_CONCURRENCY = 4;

const DEPTH_NAME_PATTERN = /limit|top_?k|depth/i;

/** Pipeline input variables the run should bind (everything but the query). */
export function declaredInputs(variables: PipelineVariable[] | undefined): PipelineVariable[] {
  return (variables ?? []).filter((variable) => variable.source === "input");
}

/**
 * Whether an input variable controls result depth (result_limit, top_k, …).
 * Depth variables default to the largest selected k so every cutoff is
 * scorable, instead of asking the user to hand-tune them.
 */
export function isDepthVariable(variable: PipelineVariable): boolean {
  if (variable.type !== "integer" && variable.type !== "number") return false;
  return DEPTH_NAME_PATTERN.test(variable.name) || variable.name === "k";
}

/** Clamp a depth value into the variable's declared bounds. */
export function clampToBounds(variable: PipelineVariable, value: number): number {
  let result = value;
  if (typeof variable.maximum === "number") result = Math.min(result, variable.maximum);
  if (typeof variable.minimum === "number") result = Math.max(result, variable.minimum);
  return result;
}

/** The default value the wizard binds for one input variable. */
export function defaultInputValue(variable: PipelineVariable, maxK: number): string {
  if (isDepthVariable(variable)) return String(clampToBounds(variable, maxK));
  if (variable.value === null || variable.value === undefined) return "";
  if (typeof variable.value === "object") return "";
  return String(variable.value);
}

/** Coerce the wizard's raw text inputs into typed run inputs. */
export function coerceInputs(
  raw: Record<string, string>,
  variables: PipelineVariable[],
  maxK: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const variable of variables) {
    const text = raw[variable.name] ?? defaultInputValue(variable, maxK);
    if (text === "") continue;
    if (variable.type === "integer" || variable.type === "number") {
      const numeric = Number(text);
      // Out-of-bounds values are clamped rather than rejected: the pipeline
      // enforces the variable's declared bounds at bind time, and a run whose
      // every query fails on a bounds error is never what the user meant.
      if (Number.isFinite(numeric)) result[variable.name] = clampToBounds(variable, numeric);
    } else if (variable.type === "boolean") {
      result[variable.name] = text === "true";
    } else {
      result[variable.name] = text;
    }
  }
  return result;
}

export interface DepthCap {
  /** The result depth this cap imposes. */
  depth: number;
  /**
   * What kind of thing imposes it. A variable's `label` is a machine name the
   * caller sends and a node's is an authored display name, so the two read
   * differently and a consumer must be able to tell them apart.
   */
  kind: "variable" | "node" | "none";
  /** The variable's name or the node's display name; empty when nothing caps. */
  label: string;
}

/**
 * The effective result depth a run can score against, and what caps it.
 *
 * The run itself requests the largest selected k, so depth only shrinks when
 * the pipeline caps it: a bound depth variable, or a node with a static
 * numeric `top_k` / `max_results` config. Expression-valued configs that
 * reference a depth variable are already covered by the variable itself.
 */
export function effectiveResultDepth(
  definition: PipelineDefinition | undefined,
  inputs: Record<string, unknown>,
  maxK: number,
): DepthCap {
  const caps: DepthCap[] = [];
  for (const variable of declaredInputs(definition?.variables)) {
    if (!isDepthVariable(variable)) continue;
    const bound = inputs[variable.name];
    if (typeof bound === "number" && Number.isFinite(bound)) {
      caps.push({ depth: bound, kind: "variable", label: variable.name });
    }
  }
  for (const node of definition?.nodes ?? []) {
    for (const key of ["top_k", "max_results"] as const) {
      const value = node.config?.[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        caps.push({ depth: value, kind: "node", label: node.name });
      }
    }
  }
  let effective: DepthCap = { depth: maxK, kind: "none", label: "" };
  for (const cap of caps) {
    if (cap.depth < effective.depth) effective = cap;
  }
  return effective;
}

/** The selected cutoffs the effective depth cannot serve. */
export function truncatedCutoffs(kValues: number[], depth: number): number[] {
  return kValues.filter((k) => k > depth);
}

/**
 * The selected cutoffs the effective depth can actually score.
 *
 * The default selection is a fixed set, but the depth a pipeline serves is a
 * property of that pipeline — so offering every cutoff regardless opens a run
 * in a configuration that can never produce the metrics it promises. Filtering
 * at render time (rather than seeding state once the pipeline loads) keeps the
 * two in step when the user switches pipeline mid-wizard.
 *
 * At least one cutoff always survives: a run with no scorable k has no metrics
 * at all, which is a worse answer than scoring the smallest one.
 */
export function serviceableCutoffs(kValues: number[], depth: number): number[] {
  const sorted = [...kValues].sort((a, b) => a - b);
  const serviceable = sorted.filter((k) => k <= depth);
  if (serviceable.length > 0) return serviceable;
  return sorted.slice(0, 1);
}
