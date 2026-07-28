"use client";

import { SetupNotice } from "@/components/setup/SetupNotice";
import { SetupStepShell } from "@/components/setup/SetupStepShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChunkWindowSummary } from "@/components/ui/chunk-window-summary";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
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
            glow
            loading={wizard.busy}
            disabled={!indexName.trim() || overCap || needsPineconeConnection}
            onClick={() => void wizard.ensureIndex()}
          >
            Create index
          </Button>
        </>
      }
    >
      <p className="max-w-[66ch] text-ui text-body">
        Embeddings from <span className="font-mono text-primary">{embeddingModel}</span> are stored
        here
        {embeddingDimension != null ? (
          <>
            {" "}
            at{" "}
            <span className="font-mono tabular-nums text-primary">
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
                "rounded-control border px-3 py-2 text-left transition-colors duration-80 ease-standard",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                selected
                  ? "border-accent-violet/40 bg-accent-violet/12 ring-1 ring-inset ring-accent-violet/30"
                  : "border-hairline bg-surface hover:border-strong hover:bg-surface-strong",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <span className="text-ui font-medium text-primary">{info.label}</span>
              <span className="mt-1 block text-instrument text-meta">
                {info.backend === "pgvector"
                  ? "Built into the shipped Postgres — no account needed."
                  : "Managed vector database — needs a Pinecone connection."}
              </span>
              {tooBig ? (
                <span className="mt-1 block text-instrument text-data-neg">
                  Max{" "}
                  <span className="font-mono tabular-nums">
                    {info.capabilities.max_dimension.toLocaleString()}
                  </span>{" "}
                  indexed dimensions — too small for this model.
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

export function StepCollection({ wizard }: { wizard: SetupWizardApi }) {
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
  // Overlap is added to chunk size, so the sum is what reaches the embedder
  // and the sum is what the model's effective window bounds. ChunkWindowSummary
  // states that arithmetic and owns the over-limit warning.
  const effectiveLimit = effectiveInputLimit(selectedModel?.max_input_tokens);

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
      stepKey="collection"
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
            glow
            disabled={!collectionName.trim() || (addReranker && !rerankerModel)}
            onClick={wizard.next}
          >
            Continue
          </Button>
        </>
      }
    >
      <p className="max-w-[66ch] text-ui text-body">
        Default ingestion and retrieval pipelines are built around{" "}
        <span className="font-mono text-primary">{embeddingModel}</span> and{" "}
        <span className="font-mono text-primary">{indexName}</span> ({backend}).
      </p>
      <Field label="Collection name">
        <TextInput
          value={collectionName}
          onChange={(event) => wizard.setChoices({ collectionName: event.target.value })}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
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
      <ChunkWindowSummary
        chunkSize={chunkSize}
        chunkOverlap={chunkOverlap}
        limit={
          effectiveLimit != null && selectedModel?.max_input_tokens != null
            ? {
                value: effectiveLimit,
                modelName: embeddingModel,
                published: selectedModel.max_input_tokens,
              }
            : null
        }
      />

      {showAggregateTools ? (
        <fieldset className="space-y-2">
          <legend>
            <InstrumentLabel>Extra tools</InstrumentLabel>
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
        <div className="space-y-2">
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
    </SetupStepShell>
  );
}
