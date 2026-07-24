"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ConnectionsManager } from "@/components/connections/ConnectionsManager";
import { SetupNotice } from "@/components/setup/SetupNotice";
import { SetupStepShell } from "@/components/setup/SetupStepShell";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { modelAvailability } from "@/lib/model-catalog-cache";
import { cn } from "@/lib/utils";
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
      title={
        <>
          Set up your{" "}
          <span className="bg-gradient-to-r from-grad-from via-grad-via to-grad-to bg-clip-text text-transparent">
            workspace
          </span>
        </>
      }
      footer={
        <Button size="lg" onClick={wizard.next}>
          Start
        </Button>
      }
    >
      <p className="text-body leading-relaxed">
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
          <Button size="lg" disabled={!wizard.providersReady} onClick={wizard.next}>
            Continue
          </Button>
        </>
      }
    >
      <p className="text-body leading-relaxed">
        Connect at least one provider for each capability below. OpenRouter covers embeddings and
        chat with one API key; an Ollama server adds local models; pgvector ships built in as the
        vector database.
      </p>
      <ul className="space-y-1.5" aria-label="Required capabilities">
        {COVERAGE_ROWS.map((row) => {
          const covered = wizard.coverage[row.kind];
          return (
            <li key={row.kind} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border",
                  covered
                    ? "border-accent-cyan/60 bg-accent-cyan/15 text-accent-cyan"
                    : "border-hairline text-transparent",
                )}
              >
                <Check className="h-3 w-3" />
              </span>
              <span className={covered ? "text-body" : "text-muted"}>
                {row.label}
                <span className="ml-1.5 text-xs text-meta">— {row.hint}</span>
              </span>
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
            disabled={!embeddingModel || selectionAvailability === "missing"}
            onClick={wizard.next}
          >
            Continue
          </Button>
        </>
      }
    >
      <p className="text-body leading-relaxed">
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
      {wizard.modelsLoading ? <p className="text-sm text-muted">Loading the catalog…</p> : null}
      <SetupNotice message={wizard.modelsError} />
      <SetupNotice message={unavailableMessage} />
      {unavailableMessage ? (
        <div className="rounded-2xl border border-data-warn/40 bg-data-warn/10 px-4 py-3">
          <p className="text-sm font-medium text-primary">Unavailable</p>
          <p className="text-[11px] text-meta break-all">
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
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  wizard.setChoices({
                    embeddingConnectionId: model.connection_id,
                    embeddingModel: model.id,
                    embeddingDimension: model.dimension ?? null,
                  });
                  // Chunk defaults are sized to this model's window (until the
                  // user edits them on the launch step).
                  wizard.seedChunkDefaults(model.max_input_tokens);
                }}
                className={cn(
                  "w-full rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                  selected
                    ? "border-accent-violet bg-accent-violet/10"
                    : "border-hairline bg-surface hover:border-strong",
                )}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-primary">{model.name}</span>
                  <span className="flex items-center gap-2">
                    {model.id === suggestedModelId ? (
                      <span className="rounded-full bg-accent-cyan/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-accent-cyan">
                        Suggested
                      </span>
                    ) : null}
                    {model.dimension != null ? (
                      <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                        {model.dimension.toLocaleString()}d
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="mt-1 block truncate text-xs text-meta">
                  {model.connection_label} · {model.id}
                </span>
                {oversized ? (
                  <span className="mt-1 block text-xs text-data-neg">
                    Over pgvector&apos;s {pgvectorCap.toLocaleString()}-dimension index limit —
                    requires Pinecone.
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {!wizard.modelsLoading && filtered.length === 0 ? (
          <li className="text-sm text-muted">No models match that search.</li>
        ) : null}
      </ul>
    </SetupStepShell>
  );
}
