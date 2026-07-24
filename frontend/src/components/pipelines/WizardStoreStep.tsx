"use client";

import { Plus } from "lucide-react";

import { BackendCard } from "@/components/pipelines/BackendCard";
import { BACKEND_TITLES } from "@/components/pipelines/CreatePipelineWizardSteps";
import { IndexBackendIcon } from "@/components/pipelines/icons/IndexBackendIcon";
import { CREATE_SENTINEL } from "@/components/pipelines/lib/pipeline-kinds";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field } from "@/components/ui/field";

import type { BackendInfo, IndexBackend, VectorIndex } from "@/lib/types";

type WizardStoreStepProps = {
  backends: BackendInfo[];
  backend: IndexBackend;
  onBackendSelect: (backend: IndexBackend) => void;
  backendIndexes: VectorIndex[];
  indexName: string;
  onIndexSelect: (value: string) => void;
  backendInfo: BackendInfo | null;
  onOpenIndexManager: () => void;
  /** Set when the chosen template can't run on the selected backend. */
  capabilityWarning: string | null;
};

/** Vector-store backend + index selection, with a per-template capability gate. */
export function WizardStoreStep({
  backends,
  backend,
  onBackendSelect,
  backendIndexes,
  indexName,
  onIndexSelect,
  backendInfo,
  onOpenIndexManager,
  capabilityWarning,
}: WizardStoreStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Vector store</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {backends.map((info) => (
            <BackendCard
              key={info.backend}
              info={info}
              selected={info.backend === backend}
              onSelect={onBackendSelect}
            />
          ))}
        </div>
      </div>
      {capabilityWarning ? (
        <p
          role="status"
          className="rounded-2xl border border-data-warn/40 bg-data-warn/10 px-3 py-2 text-xs text-data-warn"
        >
          {capabilityWarning}
        </p>
      ) : null}
      <Field
        label={`${BACKEND_TITLES[backend]} index`}
        labelClassName="font-mono text-[11px] uppercase tracking-[0.3em] text-muted"
      >
        <CustomSelect
          value={indexName}
          onValueChange={onIndexSelect}
          placeholder="Select an index"
          options={[
            { value: "", label: "Select an index" },
            ...backendIndexes.map((index) => ({
              value: index.name,
              label: `${index.name}${
                typeof index.dimension === "number" ? ` · ${index.dimension}d` : ""
              }`,
              icon: <IndexBackendIcon backend={index.backend} />,
            })),
            {
              value: CREATE_SENTINEL,
              label: "+ Add new index...",
              preventFocusRestore: true,
            },
          ]}
        />
      </Field>
      {backendInfo ? (
        <p className="text-xs text-muted">
          Up to {backendInfo.capabilities.max_dimension.toLocaleString()} dimensions · metrics:{" "}
          {backendInfo.capabilities.supported_metrics.join(", ")}
        </p>
      ) : null}
      {backendIndexes.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-body">
          <p>No {BACKEND_TITLES[backend]} indexes yet — create one to continue.</p>
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
  );
}
