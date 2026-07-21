"use client";

import { useMemo, useReducer } from "react";

import {
  buildGeneratePayload,
  COUNT_PRESETS,
  initialGenerateWizardState,
  generateWizardReducer,
  MAX_EXAMPLE_QUERIES,
  mixIsEmpty,
  resolvedQuestionCount,
  supportsStructuredOutputs,
} from "@/components/evals/lib/generate-dataset-wizard-reducer";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { WizardFooter, WizardShell } from "@/components/ui/wizard-shell";

import type {
  CatalogModel,
  Collection,
  EvalDatasetGeneratePayload,
  EvalQuestionType,
} from "@/lib/types";

interface GenerateDatasetWizardProps {
  open: boolean;
  collections: Collection[];
  chatModels: CatalogModel[];
  onGenerate: (payload: EvalDatasetGeneratePayload) => Promise<boolean>;
  onClose: () => void;
}

const STEPS = [
  { id: "source", label: "Source", description: "The collection questions are generated from." },
  { id: "model", label: "Model", description: "The chat model that writes and grades questions." },
  { id: "questions", label: "Questions", description: "How many, and what shape." },
];

const TYPE_LABELS: Record<EvalQuestionType, { label: string; detail: string }> = {
  single_fact: { label: "Single fact", detail: "One specific fact, short answer." },
  paraphrased: {
    label: "Paraphrased",
    detail: "Avoids the source's wording, the way a user half-remembers it.",
  },
  multi_detail: {
    label: "Multi-detail",
    detail: "Combines several details from one document.",
  },
};

/**
 * Generates a synthetic eval dataset from a collection: queries with
 * document-level relevance judgments, written and filtered by the selected
 * chat model. No manual labeling; the audience and example queries are
 * optional steering.
 */
export function GenerateDatasetWizard({
  open,
  collections,
  chatModels,
  onGenerate,
  onClose,
}: GenerateDatasetWizardProps) {
  const [state, dispatch] = useReducer(generateWizardReducer, initialGenerateWizardState);
  const { step, busy, message } = state;

  const modelOptions = useMemo(
    () =>
      chatModels
        .filter((model) => supportsStructuredOutputs(model))
        .map((model) => ({
          value: `${model.connection_id}::${model.id}`,
          label: `${model.connection_label} · ${model.name}`,
        })),
    [chatModels],
  );

  const stepReady = [
    state.collectionId !== "" && state.name.trim() !== "",
    state.modelKey !== "",
    !mixIsEmpty(state.typeShares),
  ][step];

  const launch = async () => {
    dispatch({ type: "launch_started" });
    const ok = await onGenerate(buildGeneratePayload(state));
    if (ok) {
      onClose();
      return;
    }
    dispatch({
      type: "launch_failed",
      message: "Generation could not start. The error is shown on the Evals page.",
    });
  };

  return (
    <WizardShell
      open={open}
      title="Evals"
      subtitle="Generate dataset"
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
          nextLabel={`Generate ${resolvedQuestionCount(state)} questions`}
          nextDisabled={!stepReady}
          busy={busy}
          onCancel={onClose}
        />
      }
    >
      {step === 0 && (
        <div className="space-y-4">
          <Field label="Collection" hint="Questions are generated from its ingested documents.">
            <CustomSelect
              value={state.collectionId}
              placeholder={collections.length ? "Select a collection" : "No collections"}
              options={collections.map((entry) => ({ value: entry.id, label: entry.name }))}
              onValueChange={(value) =>
                dispatch({
                  type: "select_collection",
                  collectionId: value,
                  collectionName:
                    collections.find((entry) => entry.id === value)?.name ?? "Collection",
                })
              }
              aria-label="Collection"
            />
          </Field>
          <Field label="Dataset name">
            <TextInput
              value={state.name}
              onChange={(event) => dispatch({ type: "set_name", name: event.target.value })}
            />
          </Field>
        </div>
      )}
      {step === 1 && (
        <div className="space-y-4">
          <Field
            label="Generation model"
            hint="Writes candidate questions and grades them. Each question costs two calls. Only models with structured-output support are listed."
          >
            <CustomSelect
              value={state.modelKey}
              placeholder={
                modelOptions.length
                  ? "Select a chat model"
                  : "No chat models with structured-output support available"
              }
              options={modelOptions}
              onValueChange={(value) => dispatch({ type: "select_model", modelKey: value })}
              aria-label="Generation model"
            />
          </Field>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Question count">
            {COUNT_PRESETS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="radio"
                aria-checked={state.preset === entry.key && state.countOverride === ""}
                onClick={() => dispatch({ type: "set_preset", preset: entry.key })}
                className={`rounded-2xl border p-4 text-left transition focus-visible:ring-2 focus-visible:ring-accent-violet ${
                  state.preset === entry.key && state.countOverride === ""
                    ? "border-accent-violet bg-surface-strong"
                    : "border-hairline bg-surface hover:border-strong"
                }`}
              >
                <p className="font-medium text-primary">{entry.label}</p>
                <p className="mt-1 text-xs text-muted">{entry.count} questions</p>
              </button>
            ))}
          </div>
          <Field
            label="Audience"
            hint="Optional. Who asks these questions — shapes tone and specificity."
          >
            <TextArea
              rows={2}
              value={state.audience}
              onChange={(event) => dispatch({ type: "set_audience", audience: event.target.value })}
              placeholder="Support engineers triaging customer incidents"
            />
          </Field>
          <Field
            label="Example queries"
            hint="Optional. Up to three real queries; generated questions match their style."
          >
            <div className="space-y-2">
              {Array.from({ length: MAX_EXAMPLE_QUERIES }, (_, index) => (
                <TextInput
                  key={index}
                  value={state.exampleQueries[index] ?? ""}
                  aria-label={`Example query ${index + 1}`}
                  onChange={(event) =>
                    dispatch({ type: "set_example_query", index, value: event.target.value })
                  }
                />
              ))}
            </div>
          </Field>
          <button
            type="button"
            className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted transition hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
            aria-expanded={state.advancedOpen}
            onClick={() => dispatch({ type: "toggle_advanced" })}
          >
            Advanced {state.advancedOpen ? "−" : "+"}
          </button>
          {state.advancedOpen && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Questions" hint="Overrides the preset when set. Max 500.">
                  <TextInput
                    inputMode="numeric"
                    value={state.countOverride}
                    onChange={(event) =>
                      dispatch({ type: "set_count_override", value: event.target.value })
                    }
                    placeholder={String(resolvedQuestionCount({ ...state, countOverride: "" }))}
                  />
                </Field>
                <Field label="Seed" hint="Same seed, same sampled contexts.">
                  <TextInput
                    inputMode="numeric"
                    value={state.seed}
                    onChange={(event) => dispatch({ type: "set_seed", seed: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Question mix" hint="Relative weights; zero removes a type.">
                <div className="grid gap-3 sm:grid-cols-3">
                  {(Object.keys(TYPE_LABELS) as EvalQuestionType[]).map((questionType) => (
                    <div key={questionType}>
                      <p className="text-sm font-medium text-primary">
                        {TYPE_LABELS[questionType].label}
                      </p>
                      <p className="mb-2 mt-0.5 text-xs text-muted">
                        {TYPE_LABELS[questionType].detail}
                      </p>
                      <TextInput
                        inputMode="numeric"
                        aria-label={`${TYPE_LABELS[questionType].label} weight`}
                        value={String(state.typeShares[questionType])}
                        onChange={(event) =>
                          dispatch({
                            type: "set_type_share",
                            questionType,
                            value: Math.max(0, Number(event.target.value) || 0),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </Field>
              {mixIsEmpty(state.typeShares) && (
                <p className="text-sm text-data-warn" role="alert">
                  At least one question type needs a weight above zero.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </WizardShell>
  );
}
