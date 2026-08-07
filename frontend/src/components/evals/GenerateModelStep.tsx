"use client";

import { useId } from "react";

import {
  modalityModelKey,
  splitModelKey,
} from "@/components/evals/lib/generate-dataset-wizard-reducer";
import { EVAL_MODALITIES, MODALITY_LABEL } from "@/components/evals/lib/modalities";
import { CHAT_MODEL_SORTS } from "@/components/models/model-catalog-filter";
import { ModelPickerInline } from "@/components/models/ModelPickerInline";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { formatContextLength } from "@/lib/format";
import { deriveCapabilities } from "@/lib/model-capabilities";

import type {
  GenerateWizardAction,
  GenerateWizardState,
} from "@/components/evals/lib/generate-dataset-wizard-reducer";
import type { ModelAnnotation } from "@/components/models/ModelCatalogList";
import type { CatalogModel, EvalModality } from "@/lib/types";

interface GenerateModelStepProps {
  state: GenerateWizardState;
  /** Chat models already narrowed to those advertising structured outputs. */
  models: CatalogModel[];
  dispatch: (action: GenerateWizardAction) => void;
}

const DESCRIPTION: Record<EvalModality, string> = {
  text: "Reads text chunks, writes candidate questions, and grades them. Each question costs two calls.",
  image:
    "Reads page images. Models that state image input are marked; most providers publish no modality list, so an unmarked model may still read them.",
};

const SHARED_DESCRIPTION =
  "Writes candidate questions from every modality the collection holds and grades them. Each question costs two calls. Only models with structured-output support are listed.";

/**
 * Mark a model whose provider states image input.
 *
 * The mark never narrows the list: a provider publishing no modality tree
 * reports nothing rather than reporting a refusal, and filtering on that
 * would empty the picker for most connections.
 */
function annotateVision(model: CatalogModel): ModelAnnotation | null {
  if (!deriveCapabilities(model).includes("image_in")) {
    return null;
  }
  return {
    badge: (
      <Chip tone="neutral" dot={false}>
        Vision
      </Chip>
    ),
  };
}

/** One modality's picker, headed by the modality it generates for. */
function ModalityPicker({
  modality,
  state,
  models,
  dispatch,
}: GenerateModelStepProps & { modality: EvalModality }) {
  const headingId = useId();
  const { connectionId, modelName } = splitModelKey(modalityModelKey(state, modality));
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-ui font-medium text-primary">
        {MODALITY_LABEL[modality]}
      </h3>
      <ModelPickerInline
        kind="chat"
        models={models}
        selectedConnectionId={connectionId}
        selectedModelId={modelName}
        onSelectModel={(chosen) =>
          dispatch(
            // Text reads the shared key, so the two controls stay one choice
            // and unchecking the box cannot strand a selection.
            modality === "text"
              ? { type: "select_model", modelKey: `${chosen.connection_id}::${chosen.id}` }
              : {
                  type: "select_modality_model",
                  modality,
                  modelKey: `${chosen.connection_id}::${chosen.id}`,
                },
          )
        }
        loading={false}
        copy={{
          placeholder: `Select a model for ${MODALITY_LABEL[modality].toLowerCase()}`,
          searchPlaceholder: "Search models across providers…",
          emptyLabel: "No chat models with structured-output support available.",
          description: DESCRIPTION[modality],
        }}
        sortOptions={CHAT_MODEL_SORTS}
        annotate={modality === "image" ? annotateVision : undefined}
        renderTrailing={(model) =>
          model.context_length ? formatContextLength(model.context_length) : null
        }
      />
    </section>
  );
}

/**
 * The model the generator reads a collection with.
 *
 * One picker covers every modality by default — the common collection is
 * text-only and a second control there is a choice with no consequence. A
 * mixed collection splits into one picker per modality; either way the
 * request carries a model for every modality.
 */
export function GenerateModelStep({ state, models, dispatch }: GenerateModelStepProps) {
  const { connectionId, modelName } = splitModelKey(state.modelKey);
  return (
    <div className="space-y-4">
      <Checkbox
        checked={state.perModality}
        onChange={() => dispatch({ type: "toggle_per_modality" })}
        label="Use a different model per modality"
      />
      {state.perModality ? (
        EVAL_MODALITIES.map((modality) => (
          <ModalityPicker
            key={modality}
            modality={modality}
            state={state}
            models={models}
            dispatch={dispatch}
          />
        ))
      ) : (
        <ModelPickerInline
          kind="chat"
          models={models}
          selectedConnectionId={connectionId}
          selectedModelId={modelName}
          onSelectModel={(chosen) =>
            dispatch({
              type: "select_model",
              modelKey: `${chosen.connection_id}::${chosen.id}`,
            })
          }
          loading={false}
          copy={{
            placeholder: "Select a chat model",
            searchPlaceholder: "Search models across providers…",
            emptyLabel: "No chat models with structured-output support available.",
            description: SHARED_DESCRIPTION,
          }}
          sortOptions={CHAT_MODEL_SORTS}
          renderTrailing={(model) =>
            model.context_length ? formatContextLength(model.context_length) : null
          }
        />
      )}
    </div>
  );
}
