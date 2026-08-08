"use client";

import { Plus } from "lucide-react";

import { BackendCard } from "@/components/pipelines/BackendCard";
import { BACKEND_TITLES } from "@/components/pipelines/CreatePipelineWizardSteps";
import { IndexBackendIcon } from "@/components/pipelines/icons/IndexBackendIcon";
import { CREATE_SENTINEL } from "@/components/pipelines/lib/pipeline-kinds";
import { PresetCard } from "@/components/pipelines/PresetCard";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import type { WizardIndexTarget } from "@/components/pipelines/hooks/use-wizard-index-target";
import type { BackendInfo, IndexBackend, VectorIndex } from "@/lib/types";

type WizardStoreStepProps = {
  backends: BackendInfo[];
  backend: IndexBackend;
  onBackendSelect: (backend: IndexBackend) => void;
  backendIndexes: VectorIndex[];
  indexName: string;
  onIndexSelect: (value: string) => void;
  backendInfo: BackendInfo | null;
  onOpenIndexRegistry: () => void;
  /** Set when the chosen template can't run on the selected backend. */
  backendUnsupported: string | null;
  /** Which kind of index the chosen template reads. */
  vectorType: "dense" | "sparse";
  /** The new-or-existing choice; a tool pipeline is always "existing". */
  target: WizardIndexTarget;
  /** Existing indexes the model's vectors don't fit, keyed by index name. */
  unusable: Map<string, string>;
  /** The width the chosen embedding model produces, when it resolves. */
  dimension: number | null;
  /** True where the wizard can create the index it names (ingestion only). */
  offersNew: boolean;
  /** Set when the named new index exists already at another width. */
  nameConflict: string | null;
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
  onOpenIndexRegistry,
  backendUnsupported,
  vectorType,
  target,
  unusable,
  dimension,
  offersNew,
  nameConflict,
}: WizardStoreStepProps) {
  const indexKind = vectorType === "sparse" ? "BM25 index" : "index";
  const indexLabel = `${BACKEND_TITLES[backend]} ${indexKind}`;
  const usableCount = backendIndexes.filter((index) => !unusable.has(index.name)).length;
  // A name can already belong to an index of the right width — the pipeline
  // then adopts it, and saying it will be created states the wrong outcome.
  const adopts = backendIndexes.some(
    (index) => index.name === target.name.trim() && !unusable.has(index.name),
  );
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
      {backendUnsupported ? (
        <p
          role="status"
          className="max-w-[66ch] rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2 text-ui text-data-warn"
        >
          {backendUnsupported}
        </p>
      ) : null}

      {offersNew ? (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Index">
          <PresetCard
            label="New index"
            hint="Created with this pipeline, sized for the embedding model."
            detail={dimension === null ? "Width read from the model" : `${dimension} dimensions`}
            detailClassName="tabular-nums"
            active={target.mode === "new"}
            onClick={() => target.setMode("new")}
          />
          <PresetCard
            label="Existing index"
            hint="Write into a store that already holds vectors of this width."
            detail={`${usableCount} of ${backendIndexes.length} usable`}
            detailClassName="tabular-nums"
            active={target.mode === "existing"}
            onClick={() => target.setMode("existing")}
          />
        </div>
      ) : null}

      {target.mode === "new" ? (
        <div className="space-y-1">
          <Field
            label={`New ${BACKEND_TITLES[backend]} index`}
            hint={
              adopts
                ? "The store this pipeline writes into. An index of this name already exists, and this pipeline writes into it."
                : "The store this pipeline writes into. Created when the pipeline is."
            }
          >
            <TextInput
              value={target.name}
              placeholder="index-name"
              className="font-mono"
              onChange={(event) => target.setName(event.target.value)}
            />
          </Field>
          {nameConflict ? (
            <p
              role="alert"
              className="max-w-[66ch] rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2 text-ui text-data-neg"
            >
              {nameConflict}
            </p>
          ) : null}
          {backendInfo?.lexical_available && target.bm25Name ? (
            <p className="max-w-[66ch] text-instrument text-meta">
              A BM25 index <span className="font-mono">{target.bm25Name}</span> sits alongside it,
              created if it does not exist yet. Hybrid search reads both — the dense index for
              meaning, the BM25 index for exact terms.
            </p>
          ) : null}
        </div>
      ) : (
        <Field label={indexLabel}>
          <CustomSelect
            value={indexName}
            onValueChange={onIndexSelect}
            placeholder="Select an index"
            options={[
              { value: "", label: "Select an index" },
              ...backendIndexes.map((index) => {
                const reason = unusable.get(index.name);
                const width = typeof index.dimension === "number" ? ` · ${index.dimension}d` : "";
                const why = reason ? ` — ${reason}` : "";
                return {
                  value: index.name,
                  label: `${index.name}${width}${why}`,
                  icon: <IndexBackendIcon backend={index.backend} />,
                  disabled: Boolean(reason),
                };
              }),
              {
                value: CREATE_SENTINEL,
                label: "+ Add new index...",
                preventFocusRestore: true,
              },
            ]}
          />
        </Field>
      )}

      {/* A BM25 index stores no vectors, so width and metric say nothing about it. */}
      {backendInfo && vectorType === "dense" ? (
        <p className="text-instrument text-meta">
          Up to{" "}
          <span className="font-mono tabular-nums">
            {backendInfo.capabilities.max_dimension.toLocaleString()}
          </span>{" "}
          dimensions · metrics:{" "}
          <span className="font-mono">{backendInfo.capabilities.supported_metrics.join(", ")}</span>
        </p>
      ) : null}
      {target.mode === "existing" && backendIndexes.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-ui text-muted">
            No {BACKEND_TITLES[backend]} {indexKind}es yet — create one to continue.
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={onOpenIndexRegistry}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create index
          </Button>
        </div>
      ) : null}
    </div>
  );
}
