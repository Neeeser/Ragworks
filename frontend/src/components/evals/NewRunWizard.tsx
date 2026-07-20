"use client";

import { useRouter } from "next/navigation";
import { useMemo, useReducer } from "react";

import { initialWizardState, wizardReducer } from "@/components/evals/lib/new-run-wizard-reducer";
import {
  clampToBounds,
  coerceInputs,
  CONCURRENCY_CHOICES,
  declaredInputs,
  defaultInputValue,
  effectiveResultDepth,
  isDepthVariable,
  K_CHOICES,
  truncatedCutoffs,
} from "@/components/evals/lib/run-config";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { WizardFooter, WizardShell } from "@/components/ui/wizard-shell";
import { createEvalRun } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import type { EvalDataset, Pipeline, PipelineVariable } from "@/lib/types";

interface NewRunWizardProps {
  open: boolean;
  datasets: EvalDataset[];
  pipelines: Pipeline[];
  onClose: () => void;
}

interface Preset {
  key: string;
  label: string;
  detail: string;
  queries: number | null; // null = all
  distractors: number | null;
}

const PRESETS: Preset[] = [
  {
    key: "quick",
    label: "Quick",
    detail: "50 queries, 200 distractors",
    queries: 50,
    distractors: 200,
  },
  {
    key: "standard",
    label: "Standard",
    detail: "500 queries, 2,000 distractors",
    queries: 500,
    distractors: 2000,
  },
  {
    key: "full",
    label: "Full",
    detail: "every query, full corpus",
    queries: null,
    distractors: null,
  },
];

const STEPS = [
  { id: "dataset", label: "Dataset", description: "What the pipelines are measured against." },
  {
    id: "pipelines",
    label: "Pipelines",
    description: "The ingestion and retrieval pair under test.",
  },
  { id: "scope", label: "Scope", description: "How much of the dataset the run covers." },
];

export function NewRunWizard({ open, datasets, pipelines, onClose }: NewRunWizardProps) {
  const { token } = useAuth();
  const router = useRouter();
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const {
    step,
    datasetId,
    ingestionId,
    retrievalId,
    preset,
    advancedOpen,
    numQueries,
    distractors,
    seed,
    concurrency,
    kSelected,
    runInputs,
    busy,
    message,
  } = state;

  const ingestionOptions = usePipelineOptions(pipelines, "ingestion");
  const retrievalOptions = usePipelineOptions(pipelines, "retrieval");

  const dataset = datasets.find((entry) => entry.id === datasetId) ?? null;
  const retrieval = pipelines.find((pipeline) => pipeline.id === retrievalId);
  const inputVariables = useMemo(
    () => declaredInputs(retrieval?.definition.variables),
    [retrieval],
  );

  const maxK = kSelected.length ? Math.max(...kSelected) : 10;
  const boundInputs = useMemo(
    () => coerceInputs(runInputs, inputVariables, maxK),
    [runInputs, inputVariables, maxK],
  );
  const depthCap = useMemo(
    () => effectiveResultDepth(retrieval?.definition, boundInputs, maxK),
    [retrieval, boundInputs, maxK],
  );
  const truncated = truncatedCutoffs(kSelected, depthCap.depth);

  const readyDatasets = datasets.filter((entry) => entry.status === "ready");
  const stepReady = [
    datasetId !== "",
    ingestionId !== "" && retrievalId !== "",
    kSelected.length > 0,
  ][step];

  const launch = async () => {
    if (!dataset) return;
    const chosen = PRESETS.find((entry) => entry.key === preset) ?? PRESETS[0];
    dispatch({ type: "launch_started" });
    try {
      const run = await createEvalRun(token!, {
        dataset_id: dataset.id,
        ingestion_pipeline_id: ingestionId,
        retrieval_pipeline_id: retrievalId,
        name: `${dataset.name} · ${chosen.label}`,
        config: {
          num_queries: resolveCount(numQueries, chosen.queries, dataset.num_queries),
          distractor_pool_size: resolveCount(
            distractors,
            chosen.distractors,
            dataset.num_corpus_docs,
          ),
          seed: Number(seed) || 0,
          concurrency,
          k_values: kSelected,
          selected_metrics: [],
          run_inputs: boundInputs,
        },
      });
      router.push(`/evals/runs/${run.id}`);
    } catch (err) {
      dispatch({ type: "launch_failed", message: getErrorMessage(err, "Could not start the run") });
    }
  };

  return (
    <WizardShell
      open={open}
      title="Evals"
      subtitle="New eval run"
      steps={STEPS}
      activeStepIndex={step}
      message={message}
      onStepChange={(next) => dispatch({ type: "set_step", step: next })}
      onClose={onClose}
      footer={
        <WizardFooter
          step={step}
          stepCount={STEPS.length}
          onBack={() => dispatch({ type: "back" })}
          onNext={() =>
            step === STEPS.length - 1 ? launch() : dispatch({ type: "set_step", step: step + 1 })
          }
          nextLabel="Start run"
          nextDisabled={!stepReady}
          busy={busy}
          onCancel={onClose}
        />
      }
    >
      {step === 0 && (
        <div className="space-y-4">
          <Field label="Dataset">
            <CustomSelect
              value={datasetId}
              placeholder={readyDatasets.length ? "Select a dataset" : "No ready datasets"}
              options={readyDatasets.map((entry) => ({
                value: entry.id,
                label: `${entry.name} (${entry.num_queries} queries, ${entry.num_corpus_docs} docs)`,
              }))}
              onValueChange={(value) => dispatch({ type: "select_dataset", datasetId: value })}
              aria-label="Dataset"
            />
          </Field>
        </div>
      )}
      {step === 1 && (
        <div className="space-y-4">
          <Field
            label="Ingestion pipeline"
            hint="Parsing, chunking, and embedding for the benchmark corpus. Runs sharing this pipeline reuse the ingested collection; changing it re-ingests."
          >
            <CustomSelect
              value={ingestionId}
              placeholder="Select an ingestion pipeline"
              options={ingestionOptions}
              onValueChange={(value) => dispatch({ type: "select_ingestion", pipelineId: value })}
              aria-label="Ingestion pipeline"
            />
          </Field>
          <Field label="Retrieval pipeline" hint="Queried once per benchmark query.">
            <CustomSelect
              value={retrievalId}
              placeholder="Select a retrieval pipeline"
              options={retrievalOptions}
              onValueChange={(value) => dispatch({ type: "select_retrieval", pipelineId: value })}
              aria-label="Retrieval pipeline"
            />
          </Field>
          {inputVariables.map((variable) => (
            <Field key={variable.name} label={variable.name} hint={inputHint(variable, maxK)}>
              <TextInput
                value={runInputs[variable.name] ?? defaultInputValue(variable, maxK)}
                onChange={(event) =>
                  dispatch({
                    type: "set_run_input",
                    name: variable.name,
                    value: event.target.value,
                  })
                }
              />
            </Field>
          ))}
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Run scope">
            {PRESETS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="radio"
                aria-checked={preset === entry.key}
                onClick={() => dispatch({ type: "set_preset", preset: entry.key })}
                className={`rounded-2xl border p-4 text-left transition focus-visible:ring-2 focus-visible:ring-accent-violet ${
                  preset === entry.key
                    ? "border-accent-violet bg-surface-strong"
                    : "border-hairline bg-surface hover:border-strong"
                }`}
              >
                <p className="font-medium text-primary">{entry.label}</p>
                <p className="mt-1 text-xs text-muted">{entry.detail}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            Sampled queries always keep every document judged relevant to them in the corpus;
            distractors set how much irrelevant material competes.
          </p>
          <Field
            label="k cutoffs"
            hint="Metrics compute at each selected depth. Each query requests the largest cutoff's worth of results."
          >
            <div className="flex flex-wrap gap-2" role="group" aria-label="k cutoffs">
              {K_CHOICES.map((k) => {
                const selected = kSelected.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => dispatch({ type: "toggle_k", k })}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 font-mono text-xs transition",
                      "focus-visible:ring-2 focus-visible:ring-accent-violet",
                      selected
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
          {truncated.length > 0 && (
            <p className="text-sm text-data-warn" role="alert">
              {depthCap.label
                ? `${depthCap.label} caps results at ${depthCap.depth}, so `
                : `The pipeline returns at most ${depthCap.depth} results, so `}
              {truncated.map((k) => `@${k}`).join(", ")} will always read as misses. Raise the cap
              or drop those cutoffs.
            </p>
          )}
          <button
            type="button"
            className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted transition hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
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
                  onValueChange={(value) =>
                    dispatch({ type: "set_concurrency", value: Number(value) })
                  }
                  aria-label="Parallel requests"
                />
              </Field>
            </div>
          )}
        </div>
      )}
    </WizardShell>
  );
}

function usePipelineOptions(pipelines: Pipeline[], kind: "ingestion" | "retrieval") {
  return useMemo(
    () =>
      pipelines
        .filter((pipeline) => pipeline.kind === kind)
        .map((pipeline) => ({ value: pipeline.id, label: pipeline.name })),
    [pipelines, kind],
  );
}

function inputHint(variable: PipelineVariable, maxK: number): string {
  if (isDepthVariable(variable)) {
    const suggested = clampToBounds(variable, maxK);
    return (
      `Result depth, held fixed for every query. Defaults to the largest k cutoff` +
      ` (${suggested}) so every selected depth can be scored.`
    );
  }
  return variable.description || "Pipeline input, held fixed for every query.";
}

function presetQueries(presetKey: string, dataset: EvalDataset | null): number {
  const chosen = PRESETS.find((entry) => entry.key === presetKey) ?? PRESETS[0];
  return resolveCount("", chosen.queries, dataset?.num_queries ?? 0);
}

function presetDistractors(presetKey: string, dataset: EvalDataset | null): number {
  const chosen = PRESETS.find((entry) => entry.key === presetKey) ?? PRESETS[0];
  return resolveCount("", chosen.distractors, dataset?.num_corpus_docs ?? 0);
}

function resolveCount(override: string, presetValue: number | null, datasetTotal: number): number {
  const numeric = Number(override);
  if (override.trim() !== "" && Number.isInteger(numeric) && numeric > 0) return numeric;
  if (presetValue === null) return Math.max(datasetTotal, 1);
  return Math.min(presetValue, Math.max(datasetTotal, 1));
}
