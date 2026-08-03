"use client";

import { CONCURRENCY_CHOICES, K_CHOICES } from "@/components/evals/lib/run-config";
import {
  presetDetail,
  presetDistractors,
  presetQueries,
  PRESETS,
} from "@/components/evals/lib/run-wizard-presets";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { ParameterId } from "@/components/ui/parameter-label";
import { humanizeIdentifier } from "@/lib/humanize";
import { cn } from "@/lib/utils";

import type { WizardAction } from "@/components/evals/lib/new-run-wizard-reducer";
import type { DepthCap } from "@/components/evals/lib/run-config";
import type { EvalDataset } from "@/lib/types";

interface NewRunScopeStepProps {
  dataset: EvalDataset | null;
  preset: string;
  /** The cutoffs the run will actually submit, after the depth cap. */
  serviceable: number[];
  /** The selected cutoffs the depth cap cannot serve. */
  truncated: number[];
  depthCap: DepthCap;
  advancedOpen: boolean;
  numQueries: string;
  distractors: string;
  seed: string;
  concurrency: number;
  dispatch: (action: WizardAction) => void;
}

/**
 * How much of the dataset a run covers, and at which cutoffs it is scored.
 *
 * Cutoffs beyond the pipeline's effective depth are unavailable rather than
 * selected-and-doomed: a run that offers @25 against a pipeline returning ten
 * results promises a metric it can only ever record as a miss.
 */
export function NewRunScopeStep({
  dataset,
  preset,
  serviceable,
  truncated,
  depthCap,
  advancedOpen,
  numQueries,
  distractors,
  seed,
  concurrency,
  dispatch,
}: NewRunScopeStepProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Run scope">
        {PRESETS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={preset === entry.key}
            onClick={() => dispatch({ type: "set_preset", preset: entry.key })}
            className={cn(
              "rounded-panel border p-3 text-left transition-colors duration-80 ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
              preset === entry.key
                ? "border-accent-violet bg-accent-violet/10"
                : "border-hairline bg-surface hover:border-strong",
            )}
          >
            <p className="text-ui font-medium text-primary">{entry.label}</p>
            <p className="mt-1 text-instrument text-muted">{presetDetail(entry, dataset)}</p>
          </button>
        ))}
      </div>
      <p className="max-w-[66ch] text-instrument text-muted">
        Sampled queries always keep every document judged relevant to them in the corpus;
        distractors set how much irrelevant material competes.
      </p>
      <Field
        label="k cutoffs"
        hint="Metrics compute at each selected depth. Each query requests the largest cutoff's worth of results."
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="k cutoffs">
          {K_CHOICES.map((k) => {
            const selected = serviceable.includes(k);
            const beyondDepth = k > depthCap.depth;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={selected}
                disabled={beyondDepth}
                title={
                  beyondDepth
                    ? `The pipeline returns at most ${depthCap.depth} results.`
                    : undefined
                }
                onClick={() => dispatch({ type: "toggle_k", k })}
                className={cn(
                  "rounded-full border px-3 py-1 font-mono text-instrument tabular-nums",
                  "transition-colors duration-80 ease-standard focus-visible:outline-none",
                  "focus-visible:ring-2 focus-visible:ring-accent-violet",
                  beyondDepth
                    ? "cursor-not-allowed border-hairline bg-surface text-meta opacity-50"
                    : selected
                      ? "border-accent-violet/60 bg-accent-violet/15 text-primary"
                      : "border-hairline bg-surface text-muted hover:border-strong hover:text-body",
                )}
              >
                @{k}
              </button>
            );
          })}
        </div>
      </Field>
      {/* The deeper cutoffs are already unavailable rather than selected-and-
          doomed, so this states the constraint and names what would lift it —
          it is not reporting a mistake the user made. */}
      {truncated.length > 0 && (
        <p className="max-w-[66ch] text-instrument text-muted">
          {depthCap.kind === "variable" ? (
            <>
              {humanizeIdentifier(depthCap.label)} (
              <ParameterId name={depthCap.label} className="text-muted" />) caps results at{" "}
              {depthCap.depth},{" "}
            </>
          ) : depthCap.kind === "node" ? (
            `${depthCap.label} caps results at ${depthCap.depth}, `
          ) : (
            `The pipeline returns at most ${depthCap.depth} results, `
          )}
          so {truncated.map((k) => `@${k}`).join(", ")} {truncated.length === 1 ? "is" : "are"}{" "}
          unavailable. Raise the cap to score deeper cutoffs.
        </p>
      )}
      <button
        type="button"
        className="rounded-control text-instrument font-medium text-muted transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        aria-expanded={advancedOpen}
        onClick={() => dispatch({ type: "toggle_advanced" })}
      >
        Advanced {advancedOpen ? "−" : "+"}
      </button>
      {advancedOpen && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Queries" hint="Overrides the preset when set.">
            <TextInput
              inputMode="numeric"
              value={numQueries}
              onChange={(event) =>
                dispatch({ type: "set_field", field: "numQueries", value: event.target.value })
              }
              placeholder={String(presetQueries(preset, dataset))}
            />
          </Field>
          <Field label="Distractor docs" hint="Overrides the preset when set.">
            <TextInput
              inputMode="numeric"
              value={distractors}
              onChange={(event) =>
                dispatch({ type: "set_field", field: "distractors", value: event.target.value })
              }
              placeholder={String(presetDistractors(preset, dataset))}
            />
          </Field>
          <Field label="Seed" hint="Same seed, same sample — runs stay comparable.">
            <TextInput
              inputMode="numeric"
              value={seed}
              onChange={(event) =>
                dispatch({ type: "set_field", field: "seed", value: event.target.value })
              }
            />
          </Field>
          <Field
            label="Parallel requests"
            hint="Retrievals and ingestions in flight at once. Lower it for a local model server; raise it if your provider tolerates parallel load."
          >
            <CustomSelect
              value={String(concurrency)}
              placeholder="Parallel requests"
              options={CONCURRENCY_CHOICES.map((value) => ({
                value: String(value),
                label: String(value),
              }))}
              onValueChange={(value) => dispatch({ type: "set_concurrency", value: Number(value) })}
              aria-label="Parallel requests"
            />
          </Field>
        </div>
      )}
    </div>
  );
}
