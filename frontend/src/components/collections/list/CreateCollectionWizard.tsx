"use client";

import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PipelineOverridesEditor } from "@/components/collections/PipelineOverridesEditor";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Loader } from "@/components/ui/loader";
import { WizardFooter, WizardShell, type WizardStep } from "@/components/ui/wizard-shell";
import { createCollection } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { Collection, CollectionCreatePayload, NodeSpec, Pipeline } from "@/lib/types";

type CreateCollectionWizardProps = {
  open: boolean;
  token: string;
  ingestionPipelines: Pipeline[];
  retrievalPipelines: Pipeline[];
  nodeSpecs: NodeSpec[];
  onClose: () => void;
  onCreated: (collection: Collection) => void;
};

const steps: WizardStep[] = [
  { id: "basics", label: "Basics", description: "Name and describe the collection." },
  { id: "pipelines", label: "Pipelines", description: "Choose ingestion and retrieval flows." },
  { id: "defaults", label: "Defaults", description: "Fine-tune default pipeline settings." },
  { id: "review", label: "Review", description: "Confirm and create the collection." },
];

export function CreateCollectionWizard({
  open,
  token,
  ingestionPipelines,
  retrievalPipelines,
  nodeSpecs,
  onClose,
  onCreated,
}: CreateCollectionWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<{
    name: string;
    description: string;
    ingestion_pipeline_id: string;
    retrieval_pipeline_id: string;
  }>({
    name: "",
    description: "",
    ingestion_pipeline_id: "",
    retrieval_pipeline_id: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ingestionOverrides, setIngestionOverrides] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [retrievalOverrides, setRetrievalOverrides] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const wasOpen = useRef(false);

  const defaultIngestion = useMemo(
    () =>
      ingestionPipelines.find((pipeline) => pipeline.is_default) ?? ingestionPipelines[0] ?? null,
    [ingestionPipelines],
  );
  const defaultRetrieval = useMemo(
    () =>
      retrievalPipelines.find((pipeline) => pipeline.is_default) ?? retrievalPipelines[0] ?? null,
    [retrievalPipelines],
  );

  const pipelineNameById = useMemo(() => {
    const entries = [...ingestionPipelines, ...retrievalPipelines].map(
      (pipeline): [string, string] => [pipeline.id, pipeline.name],
    );
    return new Map(entries);
  }, [ingestionPipelines, retrievalPipelines]);

  // Single hydrate-on-open path: the first time `open` flips true, reset the whole
  // wizard to a blank slate. On every subsequent render while still open, backfill
  // the pipeline selection once the pipeline lists (and their defaults) finish
  // loading, without clobbering a selection the user already made.
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true;
      setStepIndex(0);
      setMessage(null);
      setShowAdvanced(false);
      setIngestionOverrides({});
      setRetrievalOverrides({});
      setForm({
        name: "",
        description: "",
        ingestion_pipeline_id: defaultIngestion?.id || "",
        retrieval_pipeline_id: defaultRetrieval?.id || "",
      });
      return;
    }
    setForm((prev) => ({
      ...prev,
      ingestion_pipeline_id: prev.ingestion_pipeline_id || defaultIngestion?.id || "",
      retrieval_pipeline_id: prev.retrieval_pipeline_id || defaultRetrieval?.id || "",
    }));
  }, [open, defaultIngestion, defaultRetrieval]);

  const usesDefaultPipelines =
    !!defaultIngestion &&
    !!defaultRetrieval &&
    form.ingestion_pipeline_id === defaultIngestion.id &&
    form.retrieval_pipeline_id === defaultRetrieval.id;

  const buildOverridesFromPipeline = useCallback(
    (pipeline: Pipeline | null) => {
      /* c8 ignore next -- defensive fallback for optional pipelines */
      if (!pipeline) return {};
      const specsByType = new Map(nodeSpecs.map((spec) => [spec.type, spec]));
      return pipeline.definition.nodes.reduce<Record<string, Record<string, unknown>>>(
        (acc, node) => {
          const spec = specsByType.get(node.type);
          acc[node.id] = { ...(spec?.default_config ?? {}), ...(node.config ?? {}) };
          return acc;
        },
        {},
      );
    },
    [nodeSpecs],
  );

  if (!open) {
    return null;
  }

  // Seed the override editors once advanced options are expanded AND the default
  // pipelines are known. This runs during render (React's "adjust state when props
  // change" pattern) instead of only in the expand click handler, because the
  // pipelines/specs fetch can resolve *after* the user expanded the panel — without a
  // reactive re-seed, the editors would display fallback configs but the overrides
  // state would stay empty, so the user's first edit would submit a one-field
  // per-node config and silently drop every other seeded value. The empty-object
  // guards ensure user-entered values are never clobbered, and the non-empty check
  // on the seeded result prevents a re-render loop for pipelines with no nodes.
  if (showAdvanced && usesDefaultPipelines) {
    if (defaultIngestion && Object.keys(ingestionOverrides).length === 0) {
      const seeded = buildOverridesFromPipeline(defaultIngestion);
      if (Object.keys(seeded).length > 0) {
        setIngestionOverrides(seeded);
      }
    }
    if (defaultRetrieval && Object.keys(retrievalOverrides).length === 0) {
      const seeded = buildOverridesFromPipeline(defaultRetrieval);
      if (Object.keys(seeded).length > 0) {
        setRetrievalOverrides(seeded);
      }
    }
  }

  const canProceed = () => {
    if (stepIndex === 0) {
      return form.name.trim().length > 0;
    }
    if (stepIndex === 1) {
      return form.ingestion_pipeline_id && form.retrieval_pipeline_id;
    }
    return true;
  };

  const handleCreate = async () => {
    setCreating(true);
    setMessage(null);
    try {
      const payload: CollectionCreatePayload = {
        name: form.name,
        description: form.description,
      };
      if (form.ingestion_pipeline_id) {
        payload.ingest_pipeline_id = form.ingestion_pipeline_id;
      }
      if (form.retrieval_pipeline_id) {
        payload.tool_pipeline_ids = [form.retrieval_pipeline_id];
      }
      if (showAdvanced && usesDefaultPipelines) {
        payload.pipeline_overrides = {
          ingestion: Object.entries(ingestionOverrides).map(([nodeId, config]) => ({
            node_id: nodeId,
            config,
          })),
          retrieval: Object.entries(retrievalOverrides).map(([nodeId, config]) => ({
            node_id: nodeId,
            config,
          })),
        };
      }
      const created = await createCollection(token, payload);
      onCreated(created);
      onClose();
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to create collection."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <WizardShell
      open={open}
      title="Create collection"
      subtitle="New collection wizard"
      steps={steps}
      activeStepIndex={stepIndex}
      message={message}
      onStepChange={setStepIndex}
      onClose={onClose}
      footer={
        <WizardFooter
          step={stepIndex}
          stepCount={steps.length}
          onBack={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
          onNext={() =>
            stepIndex < steps.length - 1
              ? setStepIndex((prev) => Math.min(prev + 1, steps.length - 1))
              : handleCreate()
          }
          nextLabel="Create collection"
          nextDisabled={!canProceed()}
          busy={creating}
          onCancel={onClose}
        />
      }
    >
      {stepIndex === 0 && (
        <div className="space-y-4">
          <Field
            label="Collection name"
            labelClassName="font-mono text-[11px] uppercase tracking-[0.3em] text-muted"
          >
            <TextInput
              type="text"
              placeholder="Research vault"
              required
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </Field>
          <Field
            label="Description"
            labelClassName="font-mono text-[11px] uppercase tracking-[0.3em] text-muted"
          >
            <TextArea
              placeholder="Summarize what this collection is for."
              className="h-24"
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </Field>
        </div>
      )}

      {stepIndex === 1 && (
        <div className="space-y-4">
          <Field
            label="Ingestion pipeline"
            labelClassName="font-mono text-[11px] uppercase tracking-[0.3em] text-muted"
          >
            <Select
              value={form.ingestion_pipeline_id}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  ingestion_pipeline_id: event.target.value,
                }))
              }
            >
              {ingestionPipelines.length === 0 && <option value="">Loading pipelines...</option>}
              {ingestionPipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Retrieval pipeline"
            labelClassName="font-mono text-[11px] uppercase tracking-[0.3em] text-muted"
          >
            <Select
              value={form.retrieval_pipeline_id}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  retrieval_pipeline_id: event.target.value,
                }))
              }
            >
              {retrievalPipelines.length === 0 && <option value="">Loading pipelines...</option>}
              {retrievalPipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {stepIndex === 2 && (
        <div className="space-y-4">
          <div className="rounded-3xl border border-hairline bg-surface p-4">
            <button
              type="button"
              className="flex w-full items-center justify-between text-sm text-body"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-accent-violet" />
                Advanced pipeline defaults
              </span>
              <span className="text-xs text-muted">{showAdvanced ? "Hide" : "Show"}</span>
            </button>
            {showAdvanced ? (
              <div className="mt-4 space-y-4">
                {!usesDefaultPipelines ? (
                  <p className="text-sm text-muted">
                    Advanced options are available only when the default pipelines are selected.
                  </p>
                ) : nodeSpecs.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Loader className="h-4 w-4" />
                    Loading node settings...
                  </div>
                ) : (
                  <>
                    <PipelineOverridesEditor
                      title="Ingestion defaults"
                      pipeline={defaultIngestion}
                      nodeSpecs={nodeSpecs}
                      overrides={ingestionOverrides}
                      onOverridesChange={setIngestionOverrides}
                    />
                    <PipelineOverridesEditor
                      title="Retrieval defaults"
                      pipeline={defaultRetrieval}
                      nodeSpecs={nodeSpecs}
                      overrides={retrievalOverrides}
                      onOverridesChange={setRetrievalOverrides}
                    />
                  </>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">
                The default pipelines apply unless you enable advanced overrides.
              </p>
            )}
          </div>
        </div>
      )}

      {stepIndex === 3 && (
        <div className="space-y-4">
          <div className="rounded-3xl border border-hairline bg-surface p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Summary</p>
            <div className="mt-3 space-y-3 text-sm text-body">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-meta">Name</p>
                <p className="text-base font-semibold text-primary">{form.name || "Untitled"}</p>
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-meta">
                  Description
                </p>
                <p className="text-sm text-body">
                  {form.description || "No description provided."}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-meta">
                    Ingestion pipeline
                  </p>
                  <p className="text-sm text-primary">
                    {pipelineNameById.get(form.ingestion_pipeline_id) || "Default"}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-meta">
                    Retrieval pipeline
                  </p>
                  <p className="text-sm text-primary">
                    {pipelineNameById.get(form.retrieval_pipeline_id) || "Default"}
                  </p>
                </div>
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-meta">
                  Advanced defaults
                </p>
                <p className="text-sm text-body">
                  {showAdvanced && usesDefaultPipelines ? "Enabled" : "Not configured"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </WizardShell>
  );
}
