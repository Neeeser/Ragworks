"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { buildDefaultDefinition } from "@/components/pipelines/pipeline-utils";
import { Button } from "@/components/ui/button";
import { WizardShell, type WizardStep } from "@/components/ui/wizard-shell";
import { createPipeline } from "@/lib/api";

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

const CREATE_INDEX_VALUE = "__create__";

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

  const sortedIndexes = useMemo(
    () => [...indexes].sort((a, b) => a.name.localeCompare(b.name)),
    [indexes],
  );
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
      setMessage(error instanceof Error ? error.message : "Unable to create pipeline.");
    } finally {
      setCreating(false);
    }
  };

  const handleIndexSelect = (value: string) => {
    if (value === CREATE_INDEX_VALUE) {
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={onClose} disabled={creating} className="px-5">
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
              disabled={creating || stepIndex === 0}
              className="flex items-center gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            {stepIndex < steps.length - 1 ? (
              <Button
                onClick={() => setStepIndex((prev) => Math.min(prev + 1, steps.length - 1))}
                disabled={creating || !canProceed()}
                className="flex items-center gap-2"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleCreate} loading={creating}>
                Create pipeline
              </Button>
            )}
          </div>
        </div>
      }
    >
      {stepIndex === 0 && (
        <div>
          <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Pipeline name</label>
          <input
            type="text"
            placeholder="Ingestion: Research sync"
            required
            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>
      )}

      {stepIndex === 1 && (
        <div className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Pinecone index
            </label>
            <select
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
              value={form.index_name}
              onChange={(event) => handleIndexSelect(event.target.value)}
            >
              <option value="">Select an index</option>
              {sortedIndexes.map((index) => (
                <option key={index.name} value={index.name}>
                  {index.name}
                </option>
              ))}
              <option value={CREATE_INDEX_VALUE}>+ Add new index...</option>
            </select>
          </div>
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
