"use client";

import { useRouter } from "next/navigation";
import { useMemo, useReducer } from "react";

import { initialWizardState, wizardReducer } from "@/components/evals/lib/new-run-wizard-reducer";
import {
  clampToBounds,
  coerceInputs,
  declaredInputs,
  defaultInputValue,
  effectiveResultDepth,
  serviceableCutoffs,
  isDepthVariable,
  truncatedCutoffs,
} from "@/components/evals/lib/run-config";
import { PRESETS, resolveCount, STEPS } from "@/components/evals/lib/run-wizard-presets";
import { NewRunScopeStep } from "@/components/evals/NewRunScopeStep";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { ParameterId } from "@/components/ui/parameter-label";
import { WizardFooter, WizardShell } from "@/components/ui/wizard-shell";
import { comparePromptVersions, createEvalRun } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { humanizeIdentifier } from "@/lib/humanize";
import { useAuth } from "@/providers/auth-provider";

import type { EvalDataset, Pipeline, PipelineVariable } from "@/lib/types";

/** Two versions of one prompt to A/B, carried in from the prompt studio. */
export interface PromptComparison {
  promptId: string;
  promptName: string;
  versionA: number;
  versionB: number;
}

interface NewRunWizardProps {
  open: boolean;
  datasets: EvalDataset[];
  pipelines: Pipeline[];
  /**
   * When set, the wizard starts two runs instead of one — the same
   * dataset and settings against each version of this prompt.
   */
  comparison?: PromptComparison | null;
  onClose: () => void;
}

export function NewRunWizard({
  open,
  datasets,
  pipelines,
  comparison,
  onClose,
}: NewRunWizardProps) {
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
  // What the run can actually score. Cutoffs beyond the pipeline's depth are
  // never submitted, so a run cannot open promising metrics it will only ever
  // record as misses.
  const serviceable = serviceableCutoffs(kSelected, depthCap.depth);

  const readyDatasets = datasets.filter((entry) => entry.status === "ready");
  // The retrieval pipeline has to be one that runs the prompt, or pinning a
  // version changes nothing — the backend refuses, so say so up front.
  const retrievalHint = comparison
    ? `Pick the pipeline whose node runs ${comparison.promptName}. Each version gets its own copy of it.`
    : null;
  const stepReady = [
    datasetId !== "",
    ingestionId !== "" && retrievalId !== "",
    serviceable.length > 0,
  ][step];

  const launch = async () => {
    if (!dataset) return;
    const chosen = PRESETS.find((entry) => entry.key === preset) ?? PRESETS[0];
    dispatch({ type: "launch_started" });
    try {
      const config = {
        num_queries: resolveCount(numQueries, chosen.queries, dataset.num_queries),
        distractor_pool_size: resolveCount(
          distractors,
          chosen.distractors,
          dataset.num_corpus_docs,
        ),
        seed: Number(seed) || 0,
        concurrency,
        k_values: serviceable,
        selected_metrics: [],
        run_inputs: boundInputs,
      };
      if (comparison) {
        // Both sides share this config, so the only difference between the
        // two runs is the prompt version each pipeline copy pins.
        await comparePromptVersions(token!, {
          prompt_id: comparison.promptId,
          version_a: comparison.versionA,
          version_b: comparison.versionB,
          dataset_id: dataset.id,
          ingestion_pipeline_id: ingestionId,
          retrieval_pipeline_id: retrievalId,
          config,
        });
        router.push("/evals");
        return;
      }
      const run = await createEvalRun(token!, {
        dataset_id: dataset.id,
        ingestion_pipeline_id: ingestionId,
        retrieval_pipeline_id: retrievalId,
        name: `${dataset.name} · ${chosen.label}`,
        config,
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
      subtitle={
        comparison
          ? `Comparing ${comparison.promptName} v${comparison.versionA} and v${comparison.versionB}`
          : "New eval run"
      }
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
          nextLabel={comparison ? "Start both runs" : "Start run"}
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
          <Field label="Search tool" hint={retrievalHint ?? "Queried once per benchmark query."}>
            <CustomSelect
              value={retrievalId}
              placeholder="Select a search tool"
              options={retrievalOptions}
              onValueChange={(value) => dispatch({ type: "select_retrieval", pipelineId: value })}
              aria-label="Search tool"
            />
          </Field>
          {inputVariables.map((variable) => (
            <Field
              key={variable.name}
              label={humanizeIdentifier(variable.name)}
              labelEnd={<ParameterId name={variable.name} />}
              hint={inputHint(variable, maxK)}
            >
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
        <NewRunScopeStep
          dataset={dataset}
          preset={preset}
          serviceable={serviceable}
          truncated={truncated}
          depthCap={depthCap}
          advancedOpen={advancedOpen}
          numQueries={numQueries}
          distractors={distractors}
          seed={seed}
          concurrency={concurrency}
          dispatch={dispatch}
        />
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
