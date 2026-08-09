"use client";

import { useCallback, useEffect } from "react";

import { ConnectionsManager } from "@/components/connections/ConnectionsManager";
import { EMBEDDING_MODEL_SORTS } from "@/components/models/model-catalog-filter";
import { ModelPickerInline } from "@/components/models/ModelPickerInline";
import { SetupNotice } from "@/components/setup/SetupNotice";
import { SetupStepShell } from "@/components/setup/SetupStepShell";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { StatusDot } from "@/components/ui/status-dot";
import { catalogConnectionErrors, modelAvailability } from "@/lib/model-catalog-cache";
import { useAuth } from "@/providers/auth-provider";

import type { SetupWizardApi } from "@/components/setup/hooks/use-setup-wizard";
import type { CatalogModel, ProviderKind } from "@/lib/types";

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
              {/* The dot is the only thing saying whether this capability is
                  covered — the label beside it names the capability, not its
                  state — so it carries the words itself. */}
              <StatusDot
                tone={covered ? "pos" : "neutral"}
                srLabel={covered ? "Covered" : "Not covered"}
                className="translate-y-[-1px]"
              />
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
  const { models, suggestedModelId, refreshModels } = wizard;
  const { embeddingModel, embeddingConnectionId } = wizard.state.choices;
  const selectionAvailability = modelAvailability(
    wizard.modelCatalog,
    embeddingConnectionId,
    embeddingModel || null,
  );
  const selectedConnectionLabel =
    wizard.connections.find((connection) => connection.id === embeddingConnectionId)?.label ??
    "this connection";

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  // Backend caps are data declared on each backend — never hardcoded here.
  // NOTE(dimension-reduction): once pgvector gains dimension reduction for
  // oversized models, this warning becomes "will be reduced to N dims".
  const pgvectorCap = wizard.backends?.find((backend) => backend.backend === "pgvector")
    ?.capabilities.max_dimension;

  const annotate = useCallback(
    (model: CatalogModel) => {
      const suggested = model.id === suggestedModelId;
      const oversized =
        pgvectorCap != null && model.dimension != null && model.dimension > pgvectorCap;
      if (!suggested && !oversized) return null;
      return {
        badge: suggested ? <Chip tone="accent">Suggested</Chip> : undefined,
        note: oversized
          ? `Over pgvector's ${pgvectorCap.toLocaleString()}-dimension index limit — requires Pinecone.`
          : undefined,
      };
    },
    [pgvectorCap, suggestedModelId],
  );

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
      <ModelPickerInline
        kind="embedding"
        models={models ?? []}
        selectedConnectionId={embeddingConnectionId}
        selectedModelId={embeddingModel || null}
        onSelectModel={(model) => {
          wizard.setChoices({
            embeddingConnectionId: model.connection_id,
            embeddingModel: model.id,
            embeddingDimension: model.dimension ?? null,
          });
          // Chunk defaults are sized to this model's window (until the user
          // edits them on the launch step).
          wizard.seedChunkDefaults(model.max_input_tokens);
        }}
        loading={wizard.modelsLoading}
        modelsError={wizard.modelsError}
        connectionErrors={catalogConnectionErrors(wizard.modelCatalog)}
        onRetry={() => void refreshModels()}
        copy={{
          placeholder: "Select an embedding model",
          searchPlaceholder: "all-MiniLM, bge, embedding…",
          emptyLabel: "No embedding models available.",
        }}
        sortOptions={EMBEDDING_MODEL_SORTS}
        renderTrailing={(model) =>
          model.dimension ? `${model.dimension.toLocaleString()}d` : null
        }
        annotate={annotate}
        prioritizedModelId={suggestedModelId}
        unavailable={
          selectionAvailability === "missing"
            ? {
                modelId: embeddingModel,
                connectionLabel: selectedConnectionLabel,
                message: `Selected model is no longer available from ${selectedConnectionLabel}. Select another model.`,
              }
            : null
        }
      />
    </SetupStepShell>
  );
}
