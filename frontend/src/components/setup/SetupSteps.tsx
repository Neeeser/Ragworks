"use client";

import { useEffect, useMemo, useState } from "react";

import { ConnectionsManager } from "@/components/connections/ConnectionsManager";
import { ModelOptionButton } from "@/components/models/ModelOptionButton";
import { SetupNotice } from "@/components/setup/SetupNotice";
import { SetupStepShell } from "@/components/setup/SetupStepShell";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, TextInput } from "@/components/ui/field";
import { Readout } from "@/components/ui/readout";
import { StatusDot } from "@/components/ui/status-dot";
import { modelAvailability } from "@/lib/model-catalog-cache";
import { useAuth } from "@/providers/auth-provider";

import type { SetupWizardApi } from "@/components/setup/hooks/use-setup-wizard";
import type { ProviderKind } from "@/lib/types";

const KICKER = "First-run setup";

export function StepWelcome({ wizard }: { wizard: SetupWizardApi }) {
  return (
    <SetupStepShell
      stepKey="welcome"
      direction={wizard.state.direction}
      kicker={KICKER}
      title="Set up your workspace"
      footer={
        <>
          <span />
          <Button size="lg" glow onClick={wizard.next}>
            Start
          </Button>
        </>
      }
    >
      <p className="max-w-[66ch] text-ui text-body">
        Four choices: your providers, an embedding model, a vector index, and your first collection.
      </p>
    </SetupStepShell>
  );
}

const COVERAGE_ROWS: Array<{ kind: ProviderKind; label: string; hint: string }> = [
  { kind: "embedding", label: "Embeddings", hint: "turns documents and queries into vectors" },
  { kind: "chat", label: "Chat", hint: "answers questions over your collections" },
  { kind: "vector_store", label: "Vector database", hint: "stores and searches the vectors" },
];

export function StepProviders({ wizard }: { wizard: SetupWizardApi }) {
  const { token } = useAuth();
  return (
    <SetupStepShell
      stepKey="providers"
      direction={wizard.state.direction}
      kicker={KICKER}
      title="Connect your providers"
      footer={
        <>
          <Button variant="ghost" onClick={wizard.back}>
            Back
          </Button>
          <Button size="lg" glow disabled={!wizard.providersReady} onClick={wizard.next}>
            Continue
          </Button>
        </>
      }
    >
      <p className="max-w-[66ch] text-ui text-body">
        Connect at least one provider for each capability below. OpenRouter covers embeddings and
        chat with one API key; an Ollama server adds local models; pgvector ships built in as the
        vector database.
      </p>
      <ul className="space-y-1" aria-label="Required capabilities">
        {COVERAGE_ROWS.map((row) => {
          const covered = wizard.coverage[row.kind];
          return (
            <li key={row.kind} className="flex items-baseline gap-2">
              <StatusDot tone={covered ? "pos" : "neutral"} className="translate-y-[-1px]" />
              <span className={covered ? "text-ui text-body" : "text-ui text-muted"}>
                {row.label}
              </span>
              <span className="text-instrument text-meta">{row.hint}</span>
            </li>
          );
        })}
      </ul>
      <ConnectionsManager
        authToken={token ?? ""}
        connections={wizard.connections}
        providerTypes={wizard.providerTypes}
        loading={wizard.connectionsLoading}
        error={wizard.connectionsError}
        onChanged={wizard.reloadConnections}
      />
      <SetupNotice message={wizard.error} />
    </SetupStepShell>
  );
}

export function StepModel({ wizard }: { wizard: SetupWizardApi }) {
  const [search, setSearch] = useState("");
  const { models, suggestedModelId } = wizard;
  const { refreshModels } = wizard;
  const { embeddingModel, embeddingConnectionId } = wizard.state.choices;
  const selectionAvailability = modelAvailability(
    wizard.modelCatalog,
    embeddingConnectionId,
    embeddingModel || null,
  );
  const selectedConnectionLabel =
    wizard.connections.find((connection) => connection.id === embeddingConnectionId)?.label ??
    "this connection";
  const unavailableMessage =
    selectionAvailability === "missing"
      ? `Selected model is no longer available from ${selectedConnectionLabel}. Select another model.`
      : null;

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  // Backend caps are data declared on each backend — never hardcoded here.
  // NOTE(dimension-reduction): once pgvector gains dimension reduction for
  // oversized models, this warning becomes "will be reduced to N dims".
  const pgvectorCap = wizard.backends?.find((backend) => backend.backend === "pgvector")
    ?.capabilities.max_dimension;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = models ?? [];
    const matches = term
      ? list.filter(
          (model) =>
            model.id.toLowerCase().includes(term) ||
            model.name.toLowerCase().includes(term) ||
            model.connection_label.toLowerCase().includes(term),
        )
      : list;
    // Suggested model floats to the top so the default is one click away.
    return [...matches].sort((a, b) =>
      a.id === suggestedModelId ? -1 : b.id === suggestedModelId ? 1 : 0,
    );
  }, [models, search, suggestedModelId]);

  return (
    <SetupStepShell
      stepKey="model"
      direction={wizard.state.direction}
      kicker={KICKER}
      title="Pick an embedding model"
      footer={
        <>
          <Button variant="ghost" onClick={wizard.back}>
            Back
          </Button>
          <Button
            size="lg"
            glow
            disabled={!embeddingModel || selectionAvailability === "missing"}
            onClick={wizard.next}
          >
            Continue
          </Button>
        </>
      }
    >
      <p className="max-w-[66ch] text-ui text-body">
        Every document and query is embedded with this model, and your index&apos;s dimension is
        locked to it — so this choice comes first.
      </p>
      <Field label="Search models">
        <TextInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="all-MiniLM, bge, embedding…"
        />
      </Field>
      {wizard.modelsLoading ? <p className="text-ui text-muted">Loading the catalog…</p> : null}
      <SetupNotice message={wizard.modelsError} />
      <SetupNotice message={unavailableMessage} />
      {unavailableMessage ? (
        <div className="rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2">
          <p className="text-ui font-medium text-data-warn">Unavailable</p>
          <p className="break-all font-mono text-instrument text-meta">
            {selectedConnectionLabel} · {embeddingModel}
          </p>
        </div>
      ) : null}
      <ul className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-label="Embedding models">
        {filtered.map((model) => {
          const selected =
            model.id === embeddingModel &&
            (!embeddingConnectionId || model.connection_id === embeddingConnectionId);
          const oversized =
            pgvectorCap != null && model.dimension != null && model.dimension > pgvectorCap;
          return (
            <li key={`${model.connection_id}::${model.id}`}>
              <ModelOptionButton
                model={model}
                selected={selected}
                subtitle={
                  <>
                    {model.connection_label} · <span className="font-mono">{model.id}</span>
                  </>
                }
                onSelect={() => {
                  wizard.setChoices({
                    embeddingConnectionId: model.connection_id,
                    embeddingModel: model.id,
                    embeddingDimension: model.dimension ?? null,
                  });
                  // Chunk defaults are sized to this model's window (until the
                  // user edits them on the launch step).
                  wizard.seedChunkDefaults(model.max_input_tokens);
                }}
              >
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {model.id === suggestedModelId ? <Chip tone="accent">Suggested</Chip> : null}
                  {model.dimension != null ? (
                    <Readout label="Dimension">{model.dimension.toLocaleString()}</Readout>
                  ) : null}
                </div>
                {oversized ? (
                  <p className="mt-1 text-instrument text-data-neg">
                    Over pgvector&apos;s {pgvectorCap.toLocaleString()}-dimension index limit —
                    requires Pinecone.
                  </p>
                ) : null}
              </ModelOptionButton>
            </li>
          );
        })}
        {!wizard.modelsLoading && filtered.length === 0 ? (
          <li className="text-ui text-muted">No models match that search.</li>
        ) : null}
      </ul>
    </SetupStepShell>
  );
}
