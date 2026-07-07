"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CREATE_SENTINEL } from "@/components/pipelines/lib/pipeline-kinds";
import {
  buildDefaultDefinition,
  sortIndexesByName,
} from "@/components/pipelines/lib/pipeline-utils";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { WizardFooter, WizardShell, type WizardStep } from "@/components/ui/wizard-shell";
import { createPipeline } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { PineconeIndex, Pipeline, PipelineKind } from "@/lib/types";

type CreatePipelineWizardProps = {
  open: boolean;
  token: string;
  kind: PipelineKind;
  indexes: PineconeIndex[];
  onClose: () => void;
  onCreated: (pipeline: Pipeline) => void;
  onOpenIndexManager: () => void;
};

const steps: WizardStep[] = [
  { id: "basics", label: "Basics", description: "Name the pipeline." },
  { id: "index", label: "Index", description: "Select the Pinecone index to target." },
  { id: "review", label: "Review", description: "Confirm pipeline details." },
];

export function CreatePipelineWizard({
  open,
  token,
  kind,
  indexes,
  onClose,
  onCreated,
  onOpenIndexManager,
}: CreatePipelineWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", index_name: "" });
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setStepIndex(0);
      setMessage(null);
      setForm({ name: "", index_name: "" });
    }
    wasOpen.current = open;
  }, [open]);

  const sortedIndexes = useMemo(() => sortIndexesByName(indexes), [indexes]);
  const selectedIndex = useMemo(
    () => sortedIndexes.find((index) => index.name === form.index_name) ?? null,
    [sortedIndexes, form.index_name],
  );

  const canProceed = () => {
    if (stepIndex === 0) return form.name.trim().length > 0;
    if (stepIndex === 1) return form.index_name.trim().length > 0;
    /* c8 ignore next -- final step uses create action instead of Next */
    return true;
  };

  const handleCreate = async () => {
    setCreating(true);
    setMessage(null);
    try {
      const definition = buildDefaultDefinition(
        kind,
        form.index_name.trim(),
        selectedIndex?.dimension ?? undefined,
      );
      const created = await createPipeline(token, {
        name: form.name.trim(),
        kind,
        definition,
        change_summary: "Initial pipeline scaffold.",
      });
      onCreated(created);
      onClose();
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to create pipeline."));
    } finally {
      setCreating(false);
    }
  };

  const handleIndexSelect = (value: string) => {
    if (value === CREATE_SENTINEL) {
      onOpenIndexManager();
      return;
    }
    setForm((prev) => ({ ...prev, index_name: value }));
  };

  return (
    <WizardShell
      open={open}
      title="Create pipeline"
      subtitle={`New ${kind === "ingestion" ? "ingestion" : "retrieval"} pipeline`}
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
          nextLabel="Create pipeline"
          nextDisabled={!canProceed()}
          busy={creating}
          onCancel={onClose}
        />
      }
    >
      {stepIndex === 0 && (
        <Field
          label="Pipeline name"
          labelClassName="text-xs uppercase tracking-[0.3em] text-slate-400"
        >
          <TextInput
            type="text"
            placeholder="Ingestion: Research sync"
            required
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
        </Field>
      )}

      {stepIndex === 1 && (
        <div className="space-y-4">
          <Field
            label="Pinecone index"
            labelClassName="text-xs uppercase tracking-[0.3em] text-slate-400"
          >
            <Select
              value={form.index_name}
              onChange={(event) => handleIndexSelect(event.target.value)}
            >
              <option value="">Select an index</option>
              {sortedIndexes.map((index) => (
                <option key={index.name} value={index.name}>
                  {index.name}
                </option>
              ))}
              <option value={CREATE_SENTINEL}>+ Add new index...</option>
            </Select>
          </Field>
          {sortedIndexes.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <p>No Pinecone indexes found for this API key.</p>
              <Button
                variant="secondary"
                onClick={onOpenIndexManager}
                className="mt-3 flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Create index
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {stepIndex === 2 && (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Summary</p>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Pipeline name</p>
              <p className="text-base font-semibold text-white">{form.name || "Untitled"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Pipeline type</p>
              <p className="text-sm text-white">
                {kind === "ingestion" ? "Ingestion" : "Retrieval"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Pinecone index</p>
              <p className="text-sm text-white">{form.index_name || "Not selected"}</p>
            </div>
          </div>
        </div>
      )}
    </WizardShell>
  );
}
