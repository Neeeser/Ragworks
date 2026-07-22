"use client";

import { Plus, X } from "lucide-react";
import { useReducer } from "react";

import {
  buildGeneratePayload,
  COUNT_PRESETS,
  initialGenerateWizardState,
  generateWizardReducer,
  mixIsEmpty,
  resolvedQuestionCount,
  supportsStructuredOutputs,
} from "@/components/evals/lib/generate-dataset-wizard-reducer";
import {
  CHAT_MODEL_SORTS,
  useModelCatalogFilter,
} from "@/components/models/model-catalog-filter";
import { ModelCatalogPicker } from "@/components/models/ModelCatalogPicker";
import { ModelMetaBadge, ModelOptionButton } from "@/components/models/ModelOptionButton";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { WizardFooter, WizardShell } from "@/components/ui/wizard-shell";
import { formatContextLength, formatPricePerMillion } from "@/lib/format";

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

/** Split a `${connection_id}::${model_id}` key back into its parts. */
function splitModelKey(modelKey: string): { connectionId: string; modelName: string } {
  const [connectionId, ...rest] = modelKey.split("::");
  return { connectionId: connectionId ?? "", modelName: rest.join("::") };
}

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

  const modelFilter = useModelCatalogFilter({
    models: chatModels,
    prefilter: supportsStructuredOutputs,
    enableProviderFilter: true,
    sortOptions: CHAT_MODEL_SORTS,
  });
  const { connectionId: selectedConnectionId, modelName: selectedModelName } = splitModelKey(
    state.modelKey,
  );
  const currentModel =
    chatModels.find(
      (model) => model.connection_id === selectedConnectionId && model.id === selectedModelName,
    ) ?? null;

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
        <ModelCatalogPicker
          models={modelFilter.filteredModels}
          selectedModelKey={state.modelKey}
          currentModel={currentModel}
          headerPlaceholder="Select a chat model"
          headerSubtitle={
            currentModel ? `${currentModel.connection_label} · ${currentModel.id}` : null
          }
          description="Writes candidate questions and grades them. Each question costs two calls. Only models with structured-output support are listed."
          modelsLoading={false}
          searchTerm={modelFilter.searchTerm}
          onSearchChange={modelFilter.setSearchTerm}
          searchPlaceholder="Search models across providers…"
          connectionOptions={modelFilter.connectionOptions}
          connectionFilter={modelFilter.connectionFilter}
          onConnectionFilterChange={modelFilter.setConnectionFilter}
          sortOptions={CHAT_MODEL_SORTS}
          sortValue={modelFilter.sortValue}
          onSortChange={modelFilter.setSortValue}
          groupByConnection
          noun="chat model"
          emptyLabel="No chat models with structured-output support available."
          renderModel={(model) => {
            const modelKey = `${model.connection_id}::${model.id}`;
            const contextLabel = model.context_length
              ? formatContextLength(model.context_length)
              : null;
            const promptLabel = formatPricePerMillion(model.pricing?.prompt);
            const completionLabel = formatPricePerMillion(model.pricing?.completion);
            return (
              <ModelOptionButton
                key={modelKey}
                model={model}
                selected={state.modelKey === modelKey}
                onSelect={(chosen) =>
                  dispatch({
                    type: "select_model",
                    modelKey: `${chosen.connection_id}::${chosen.id}`,
                  })
                }
                subtitle={`${model.connection_label} · ${model.id}`}
              >
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                  {contextLabel ? <ModelMetaBadge label="ctx" value={contextLabel} /> : null}
                  {promptLabel ? <ModelMetaBadge label="in" value={promptLabel} /> : null}
                  {completionLabel ? <ModelMetaBadge label="out" value={completionLabel} /> : null}
                </div>
              </ModelOptionButton>
            );
          }}
        />
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

          <div className="rounded-2xl border border-hairline bg-surface/40">
            <button
              type="button"
              aria-expanded={state.steeringOpen}
              onClick={() => dispatch({ type: "toggle_steering" })}
              className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              <span className="flex items-center gap-2.5">
                <span className="text-sm font-medium text-primary">Steering</span>
                <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.28em] text-meta">
                  Optional
                </span>
              </span>
              <span className="font-mono text-[13px] leading-none text-muted">
                {state.steeringOpen ? "−" : "+"}
              </span>
            </button>
            {state.steeringOpen && (
              <div className="space-y-4 border-t border-hairline px-4 py-4">
                <Field label="Audience" hint="Who asks these questions — shapes tone and specificity.">
                  <TextArea
                    rows={2}
                    value={state.audience}
                    onChange={(event) =>
                      dispatch({ type: "set_audience", audience: event.target.value })
                    }
                    placeholder="Support engineers triaging customer incidents"
                  />
                </Field>
                <Field
                  label="Example queries"
                  hint="Real queries whose style the generated questions imitate. Add as many as you like."
                >
                  <div className="space-y-2">
                    {state.exampleQueries.map((value, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <TextInput
                          className="flex-1"
                          value={value}
                          aria-label={`Example query ${index + 1}`}
                          onChange={(event) =>
                            dispatch({
                              type: "set_example_query",
                              index,
                              value: event.target.value,
                            })
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Remove example query ${index + 1}`}
                          onClick={() => dispatch({ type: "remove_example_query", index })}
                          className="rounded-full p-2 text-muted transition hover:bg-surface-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "add_example_query" })}
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.28em] text-muted transition hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Add example query
                    </button>
                  </div>
                </Field>
              </div>
            )}
          </div>

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
