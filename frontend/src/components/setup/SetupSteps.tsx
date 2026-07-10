"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import { useOpenRouterKeyValidation } from "@/components/setup/hooks/use-key-validation";
import { SetupNotice } from "@/components/setup/SetupNotice";
import { SetupStepShell } from "@/components/setup/SetupStepShell";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import type { SetupWizardApi } from "@/components/setup/hooks/use-setup-wizard";

const KICKER = "First-run setup";

export function StepWelcome({ wizard }: { wizard: SetupWizardApi }) {
  return (
    <SetupStepShell
      stepKey="welcome"
      direction={wizard.state.direction}
      kicker={KICKER}
      title={
        <>
          Let&apos;s wire up your{" "}
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
        Four choices: an OpenRouter key, an embedding model, a vector index, and your first
        collection.
      </p>
    </SetupStepShell>
  );
}

export function StepKey({ wizard }: { wizard: SetupWizardApi }) {
  const [key, setKey] = useState("");
  const validation = useOpenRouterKeyValidation(key);
  return (
    <SetupStepShell
      stepKey="key"
      direction={wizard.state.direction}
      kicker={KICKER}
      title="Connect OpenRouter"
      footer={
        <>
          <Button variant="ghost" onClick={wizard.back}>
            Back
          </Button>
          {wizard.keyConfigured && !key ? (
            <Button size="lg" onClick={wizard.next}>
              Continue
            </Button>
          ) : (
            <Button
              size="lg"
              loading={wizard.busy}
              disabled={validation.state !== "valid"}
              onClick={() => void wizard.saveKey(key)}
            >
              Save & continue
            </Button>
          )}
        </>
      }
    >
      <p className="text-body leading-relaxed">
        Embeddings and chat both run through OpenRouter. Your key is stored on your account and
        never shared.
      </p>
      {wizard.keyConfigured ? (
        <p className="flex items-center gap-2 text-sm text-body">
          <Check aria-hidden className="h-4 w-4 text-accent-cyan" />A key is already connected —
          continue, or paste a new one to replace it.
        </p>
      ) : null}
      <Field label="OpenRouter API key">
        <TextInput
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="sk-or-…"
          autoComplete="off"
        />
      </Field>
      <div aria-live="polite">
        {validation.state === "checking" ? (
          <p className="text-sm text-muted">Checking the key with OpenRouter…</p>
        ) : null}
        {validation.state === "valid" ? (
          <p className="flex items-center gap-2 text-sm text-body">
            <Check aria-hidden className="h-4 w-4 text-accent-cyan" />
            Key verified.
          </p>
        ) : null}
        <SetupNotice message={validation.state === "invalid" ? validation.message : null} />
      </div>
      <SetupNotice message={wizard.error} />
    </SetupStepShell>
  );
}

export function StepModel({ wizard }: { wizard: SetupWizardApi }) {
  const [search, setSearch] = useState("");
  const { models, suggestedModelId } = wizard;
  const { embeddingModel } = wizard.state.choices;

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
            model.id.toLowerCase().includes(term) || model.name.toLowerCase().includes(term),
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
          <Button size="lg" disabled={!embeddingModel} onClick={wizard.next}>
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
      <ul className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-label="Embedding models">
        {filtered.map((model) => {
          const selected = model.id === embeddingModel;
          const oversized =
            pgvectorCap != null && model.dimension != null && model.dimension > pgvectorCap;
          return (
            <li key={model.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  wizard.setChoices({
                    embeddingModel: model.id,
                    embeddingDimension: model.dimension ?? null,
                  })
                }
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
                <span className="mt-1 block truncate text-xs text-meta">{model.id}</span>
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
