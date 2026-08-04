"use client";

import { Plus, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PipelineSelect } from "@/components/pipelines/PipelineSelect";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { WizardFooter, WizardShell, type WizardStep } from "@/components/ui/wizard-shell";
import { createCollection } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { Collection, CollectionCreatePayload, Pipeline } from "@/lib/types";

type CreateCollectionWizardProps = {
  open: boolean;
  token: string;
  ingestionPipelines: Pipeline[];
  retrievalPipelines: Pipeline[];
  onClose: () => void;
  onCreated: (collection: Collection) => void;
};

const steps: WizardStep[] = [
  { id: "basics", label: "Basics", description: "Name and describe the collection." },
  {
    id: "pipelines",
    label: "Pipelines",
    description: "The pipeline that ingests files and the tools chat can call.",
  },
  { id: "review", label: "Review", description: "Confirm and create the collection." },
];

/**
 * A pipeline's base tool identity: its query-input node's declared name, or
 * "search" when unset. Mirrors the backend's `tool_base_name`
 * (`app/services/tool_naming.py`) so the wizard can catch a same-collection
 * name collision before submit instead of only after a 400 comes back.
 */
function toolBaseName(pipeline: Pipeline | undefined): string {
  const declared = pipeline?.interface?.tool_name?.trim() ?? "";
  const slug = declared
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  return slug || "search";
}

export function CreateCollectionWizard({
  open,
  token,
  ingestionPipelines,
  retrievalPipelines,
  onClose,
  onCreated,
}: CreateCollectionWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ingestionPipelineId, setIngestionPipelineId] = useState("");
  /** Tool pipelines in binding order — the first is the primary search tool. */
  const [toolPipelineIds, setToolPipelineIds] = useState<string[]>([]);
  const [pipelineToAdd, setPipelineToAdd] = useState("");
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

  const pipelineById = useMemo(() => {
    const entries = [...ingestionPipelines, ...retrievalPipelines].map(
      (pipeline): [string, Pipeline] => [pipeline.id, pipeline],
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
      setName("");
      setDescription("");
      setPipelineToAdd("");
      setIngestionPipelineId(defaultIngestion?.id ?? "");
      setToolPipelineIds(defaultRetrieval ? [defaultRetrieval.id] : []);
      return;
    }
    setIngestionPipelineId((prev) => prev || (defaultIngestion?.id ?? ""));
    setToolPipelineIds((prev) =>
      prev.length > 0 ? prev : defaultRetrieval ? [defaultRetrieval.id] : [],
    );
  }, [open, defaultIngestion, defaultRetrieval]);

  const unboundToolPipelines = useMemo(
    () => retrievalPipelines.filter((pipeline) => !toolPipelineIds.includes(pipeline.id)),
    [retrievalPipelines, toolPipelineIds],
  );

  const nameProvided = name.trim().length > 0;
  const pipelinesChosen = Boolean(ingestionPipelineId) && toolPipelineIds.length > 0;

  const stepValid = (index: number) => {
    if (index === 0) return nameProvided;
    if (index === 1) return pipelinesChosen;
    return true;
  };

  // The furthest step reachable from the step list: every earlier step must be
  // satisfied, so a blank name can't be walked past by clicking ahead.
  const maxReachableStepIndex = nameProvided ? (pipelinesChosen ? steps.length - 1 : 1) : 0;

  const addTool = () => {
    if (!pipelineToAdd) return;
    setMessage(null);
    const candidate = pipelineById.get(pipelineToAdd);
    const candidateBase = toolBaseName(candidate);
    const collidingId = toolPipelineIds.find(
      (id) => toolBaseName(pipelineById.get(id)) === candidateBase,
    );
    if (collidingId) {
      const collidingName = pipelineById.get(collidingId)?.name ?? collidingId;
      const candidateName = candidate?.name ?? pipelineToAdd;
      setMessage(
        `Pipelines '${collidingName}' and '${candidateName}' would both expose the tool ` +
          `name '${candidateBase}' in this collection. Set a unique tool name (the ` +
          "'tool_name' field) on the query-input node of one of them before adding it here.",
      );
      return;
    }
    setToolPipelineIds((prev) => (prev.includes(pipelineToAdd) ? prev : [...prev, pipelineToAdd]));
    setPipelineToAdd("");
  };

  const removeTool = (pipelineId: string) => {
    setMessage(null);
    setToolPipelineIds((prev) => prev.filter((id) => id !== pipelineId));
  };

  const makePrimary = (pipelineId: string) => {
    setToolPipelineIds((prev) => [pipelineId, ...prev.filter((id) => id !== pipelineId)]);
  };

  const handleCreate = async () => {
    setCreating(true);
    setMessage(null);
    try {
      const payload: CollectionCreatePayload = {
        name: name.trim(),
        description,
      };
      if (ingestionPipelineId) {
        payload.ingest_pipeline_id = ingestionPipelineId;
      }
      if (toolPipelineIds.length > 0) {
        payload.tool_pipeline_ids = toolPipelineIds;
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

  if (!open) {
    return null;
  }

  return (
    <WizardShell
      open={open}
      title="Create collection"
      subtitle="New collection"
      steps={steps}
      activeStepIndex={stepIndex}
      message={message}
      maxReachableStepIndex={maxReachableStepIndex}
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
          nextDisabled={!stepValid(stepIndex)}
          busy={creating}
          onCancel={onClose}
        />
      }
    >
      {stepIndex === 0 && (
        <div className="space-y-4">
          <Field label="Collection name">
            <TextInput
              type="text"
              placeholder="Research vault"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Description" hint="Optional.">
            <TextArea
              placeholder="Summarize what this collection is for."
              className="h-24"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
      )}

      {stepIndex === 1 && (
        <div className="space-y-4">
          <Field label="Ingestion pipeline" hint="Runs on every file uploaded to this collection.">
            <PipelineSelect
              label="Ingestion pipeline"
              pipelines={ingestionPipelines}
              value={ingestionPipelineId}
              onChange={setIngestionPipelineId}
            />
          </Field>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <InstrumentLabel>Tools</InstrumentLabel>
              <p className="text-instrument text-muted">
                The first tool is the primary search tool.
              </p>
            </div>
            <ul className="mt-2 space-y-2">
              {toolPipelineIds.map((pipelineId, index) => {
                const pipeline = pipelineById.get(pipelineId);
                const isPrimary = index === 0;
                return (
                  <li
                    key={pipelineId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-hairline bg-surface px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {isPrimary && (
                        <Star
                          className="h-3.5 w-3.5 shrink-0 text-accent-violet"
                          aria-label="Primary search tool"
                        />
                      )}
                      <span className="truncate text-ui text-primary">
                        {pipeline?.name ?? pipelineId}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {!isPrimary && (
                        <Button variant="ghost" size="sm" onClick={() => makePrimary(pipelineId)}>
                          Make primary
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${pipeline?.name ?? "tool"}`}
                        onClick={() => removeTool(pipelineId)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
              {toolPipelineIds.length === 0 && (
                <li className="rounded-control border border-hairline bg-surface px-3 py-2 text-ui text-muted">
                  Add at least one retrieval pipeline for chat to call.
                </li>
              )}
            </ul>

            {unboundToolPipelines.length > 0 && (
              <div className="mt-2 flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <PipelineSelect
                    label="Retrieval pipeline to add as a tool"
                    pipelines={unboundToolPipelines}
                    value={pipelineToAdd}
                    onChange={setPipelineToAdd}
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={addTool}
                  disabled={!pipelineToAdd}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add tool
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {stepIndex === 2 && (
        <div className="rounded-panel border border-hairline bg-surface p-3">
          <div className="space-y-3">
            <div>
              <InstrumentLabel>Name</InstrumentLabel>
              <p className="text-head font-semibold text-primary">{name.trim() || "Untitled"}</p>
              {description.trim() && <p className="mt-1 text-ui text-body">{description}</p>}
            </div>
            <div>
              <InstrumentLabel>Ingestion pipeline</InstrumentLabel>
              <p className="text-ui text-primary">
                {pipelineById.get(ingestionPipelineId)?.name ?? "Default"}
              </p>
            </div>
            <div>
              <InstrumentLabel>Tools</InstrumentLabel>
              <ul className="mt-1 space-y-1">
                {toolPipelineIds.map((pipelineId, index) => (
                  <li key={pipelineId} className="text-ui text-primary">
                    {pipelineById.get(pipelineId)?.name ?? pipelineId}
                    {index === 0 && <span className="text-muted"> · primary search</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </WizardShell>
  );
}
