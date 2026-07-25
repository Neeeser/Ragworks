"use client";

import { Plus } from "lucide-react";

import { BackendCard } from "@/components/pipelines/BackendCard";
import { BACKEND_TITLES } from "@/components/pipelines/CreatePipelineWizardSteps";
import { IndexBackendIcon } from "@/components/pipelines/icons/IndexBackendIcon";
import { CREATE_SENTINEL } from "@/components/pipelines/lib/pipeline-kinds";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";

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
    <div className="space-y-3">
      <div>
        <InstrumentLabel>Vector store</InstrumentLabel>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
          className="max-w-[66ch] rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2 text-ui text-data-warn"
        >
          {capabilityWarning}
        </p>
      ) : null}
      <Field label={`${BACKEND_TITLES[backend]} index`}>
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
        <p className="text-instrument text-meta">
          Up to{" "}
          <span className="font-mono tabular-nums">
            {backendInfo.capabilities.max_dimension.toLocaleString()}
          </span>{" "}
          dimensions · metrics:{" "}
          <span className="font-mono">{backendInfo.capabilities.supported_metrics.join(", ")}</span>
        </p>
      ) : null}
      {backendIndexes.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-ui text-muted">
            No {BACKEND_TITLES[backend]} indexes yet — create one to continue.
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={onOpenIndexManager}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create index
          </Button>
        </div>
      ) : null}
    </div>
  );
}
