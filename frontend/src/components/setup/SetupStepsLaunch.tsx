"use client";

import { SetupNotice } from "@/components/setup/SetupNotice";
import { SetupStepShell } from "@/components/setup/SetupStepShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { effectiveInputLimit } from "@/lib/chunk-defaults";
import { cn } from "@/lib/utils";

import type { SetupWizardApi } from "@/components/setup/hooks/use-setup-wizard";
import type { CustomSelectOption } from "@/components/ui/custom-select";
import type { IndexBackend } from "@/lib/types";

const KICKER = "First-run setup";

export function StepIndex({ wizard }: { wizard: SetupWizardApi }) {
  const { backend, indexName, embeddingDimension, embeddingModel } = wizard.state.choices;
  const backends = wizard.backends ?? [];
  const chosen = backends.find((info) => info.backend === backend);
  // A model larger than the backend's indexable dimension can't land here.
  // NOTE(dimension-reduction): planned future work reduces oversized vectors
  // instead of blocking; keep this a capability read so that swap is local.
  const overCap =
    embeddingDimension != null &&
    chosen != null &&
    embeddingDimension > chosen.capabilities.max_dimension;
  // Pinecone needs its connection from the providers step — no inline key form.
  const needsPineconeConnection = backend === "pinecone" && !chosen?.configured;

  return (
    <SetupStepShell
      stepKey="index"
      direction={wizard.state.direction}
      kicker={KICKER}
      title="Create your vector index"
      footer={
        <>
          <Button variant="ghost" onClick={wizard.back}>
            Back
          </Button>
          <Button
            size="lg"
            loading={wizard.busy}
            disabled={!indexName.trim() || overCap || needsPineconeConnection}
            onClick={() => void wizard.ensureIndex()}
          >
            Create index
          </Button>
        </>
      }
    >
      <p className="text-body leading-relaxed">
        Embeddings from <span className="text-primary">{embeddingModel}</span> are stored here
        {embeddingDimension != null ? (
          <>
            {" "}
            at <span className="font-mono text-primary">
              {embeddingDimension.toLocaleString()}
            </span>{" "}
            dimensions
          </>
        ) : null}
        .
      </p>
      <div
        role="radiogroup"
        aria-label="Vector store backend"
        className="grid gap-2 sm:grid-cols-2"
      >
        {backends.map((info) => {
          const selected = info.backend === backend;
          const disabled = !info.available;
          const tooBig =
            embeddingDimension != null && embeddingDimension > info.capabilities.max_dimension;
          return (
            <button
              key={info.backend}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => wizard.setChoices({ backend: info.backend as IndexBackend })}
              className={cn(
                "rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                selected
                  ? "border-accent-violet bg-accent-violet/10"
                  : "border-hairline bg-surface hover:border-strong",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="text-sm font-medium text-primary">{info.label}</span>
              <span className="mt-1 block text-xs text-meta">
                {info.backend === "pgvector"
                  ? "Built into the shipped Postgres — no account needed."
                  : "Managed vector database — needs a Pinecone connection."}
              </span>
              {tooBig ? (
                <span className="mt-1 block text-xs text-data-neg">
                  Max {info.capabilities.max_dimension.toLocaleString()} indexed dimensions — too
                  small for this model.
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {needsPineconeConnection ? (
        <SetupNotice message="Pinecone needs a connection — go back to the providers step and add one." />
      ) : null}
      <Field label="Index name" hint="Lowercase letters, digits, and dashes.">
        <TextInput
          value={indexName}
          onChange={(event) => wizard.setChoices({ indexName: event.target.value })}
        />
      </Field>
      {overCap && chosen ? (
        <SetupNotice
          message={`${chosen.label} supports up to ${chosen.capabilities.max_dimension.toLocaleString()} indexed dimensions; pick a smaller model or another backend.`}
        />
      ) : null}
      <SetupNotice message={wizard.error} />
    </SetupStepShell>
  );
}

export function StepLaunch({ wizard }: { wizard: SetupWizardApi }) {
  const {
    collectionName,
    chunkSize,
    chunkOverlap,
    embeddingModel,
    indexName,
    backend,
    addCountTool,
    addFacetTool,
    addReranker,
    rerankerModel,
  } = wizard.state.choices;
  const selectedModel = wizard.models?.find((model) => model.id === embeddingModel);
  // Each chunk spans at most chunk_size tokens (overlap is a stride within the
  // window), so the model's effective window bounds chunk_size, not the sum.
  const effectiveLimit = effectiveInputLimit(selectedModel?.max_input_tokens);
  const chunkSizeWarning =
    effectiveLimit != null && chunkSize > effectiveLimit
      ? `Chunk size (${chunkSize.toLocaleString()}) exceeds this model's effective input limit of ${effectiveLimit.toLocaleString()} tokens; oversized chunks are split before indexing.`
      : null;

  const chosenBackend = wizard.backends?.find((info) => info.backend === backend);
  const supportsCount = chosenBackend?.capabilities.supports_lexical_count ?? false;
  const supportsFacet = chosenBackend?.capabilities.supports_lexical_facet ?? false;
  const showAggregateTools = supportsCount || supportsFacet;

  const rerankerOptions: CustomSelectOption[] = (wizard.rerankingModels ?? []).map((model) => ({
    value: `${model.connection_id}::${model.id}`,
    label: `${model.name} · ${model.connection_label}`,
  }));

  return (
    <SetupStepShell
      stepKey="launch"
      direction={wizard.state.direction}
      kicker={KICKER}
      title="Name your first collection"
      footer={
        <>
          <Button variant="ghost" onClick={wizard.back}>
            Back
          </Button>
          <Button
            size="lg"
            loading={wizard.busy}
            disabled={!collectionName.trim() || (addReranker && !rerankerModel)}
            onClick={() => void wizard.finish()}
          >
            Finish setup
          </Button>
        </>
      }
    >
      <p className="text-body leading-relaxed">
        This installs default ingestion and retrieval pipelines around{" "}
        <span className="text-primary">{embeddingModel}</span> and{" "}
        <span className="font-mono text-primary">{indexName}</span> ({backend}), then drops you on
        the collection ready to upload.
      </p>
      <Field label="Collection name">
        <TextInput
          value={collectionName}
          onChange={(event) => wizard.setChoices({ collectionName: event.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Chunk size (tokens)">
          <TextInput
            type="number"
            min={64}
            value={chunkSize}
            onChange={(event) => wizard.setChunk({ chunkSize: Number(event.target.value) || 0 })}
          />
        </Field>
        <Field label="Chunk overlap">
          <TextInput
            type="number"
            min={0}
            value={chunkOverlap}
            onChange={(event) => wizard.setChunk({ chunkOverlap: Number(event.target.value) || 0 })}
          />
        </Field>
      </div>
      <SetupNotice message={chunkSizeWarning} tone="warning" />

      {showAggregateTools ? (
        <fieldset className="space-y-3">
          <legend className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
            Extra tools
          </legend>
          {supportsCount ? (
            <Checkbox
              checked={addCountTool}
              onChange={(checked) => wizard.setChoices({ addCountTool: checked })}
              label="Add a count tool"
              description="Lets the assistant count how many documents and chunks match a query."
            />
          ) : null}
          {supportsFacet ? (
            <Checkbox
              checked={addFacetTool}
              onChange={(checked) => wizard.setChoices({ addFacetTool: checked })}
              label="Add a facet-by-source tool"
              description="Lets the assistant group matching chunks by source file, with per-file counts."
            />
          ) : null}
        </fieldset>
      ) : null}

      {wizard.hasRerankingProvider ? (
        <div className="space-y-3">
          <Checkbox
            checked={addReranker}
            onChange={(checked) => wizard.setChoices({ addReranker: checked })}
            label="Add a reranker to the search tool"
            description="Over-fetches candidates and reorders them with a reranking model for higher precision."
          />
          {addReranker ? (
            <Field label="Reranking model">
              <CustomSelect
                value={
                  rerankerModel
                    ? `${wizard.state.choices.rerankerConnectionId}::${rerankerModel}`
                    : ""
                }
                options={rerankerOptions}
                placeholder={
                  wizard.rerankingModelsLoading ? "Loading models…" : "Select a reranking model"
                }
                onValueChange={(value) => {
                  const [connectionId, model] = value.split("::");
                  wizard.setChoices({
                    rerankerConnectionId: connectionId,
                    rerankerModel: model,
                  });
                }}
                aria-label="Reranking model"
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      <SetupNotice message={wizard.warning} tone="warning" />
      <SetupNotice message={wizard.error} />
    </SetupStepShell>
  );
}
