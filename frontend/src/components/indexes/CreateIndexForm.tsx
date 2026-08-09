"use client";

import { Plus } from "lucide-react";

import { EmbeddingModelSelectorCard } from "@/components/pipelines/EmbeddingModelSelectorCard";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, Select, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { catalogConnectionErrors } from "@/lib/model-catalog-cache";

import { CLOUD_OPTIONS, REGION_OPTIONS, useCreateIndexForm } from "./use-create-index-form";

import type { SegmentedOption } from "@/components/ui/segmented-control";
import type { BackendInfo, CatalogModel, ModelCatalogResponse } from "@/lib/types";

const DIMENSION_MODES: Array<SegmentedOption<"manual" | "model">> = [
  { id: "manual", label: "Manual" },
  { id: "model", label: "From model" },
];

type CreateIndexFormProps = {
  token: string;
  backendInfo: BackendInfo;
  embeddingModels: CatalogModel[];
  embeddingCatalog: ModelCatalogResponse | null;
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  onCreateStart: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
};

/** The "create new index" form. Everything the backend constrains — metric
 * options, the dimension ceiling, sparse support, cloud placement — renders
 * from the backend's served capabilities; the coupling logic lives in
 * `useCreateIndexForm` and this component is purely presentational. */
export function CreateIndexForm({
  token,
  backendInfo,
  embeddingModels,
  embeddingCatalog,
  embeddingModelsLoading,
  embeddingModelsError,
  onCreateStart,
  onCreated,
  onError,
}: CreateIndexFormProps) {
  const form = useCreateIndexForm({
    token,
    backendInfo,
    embeddingModels,
    embeddingCatalog,
    onCreateStart,
    onCreated,
    onError,
  });
  const isDense = !form.supportsSparse || form.createForm.vector_type !== "sparse";

  return (
    <Panel className="shrink-0 overflow-hidden">
      <div className="flex h-8 flex-wrap items-center justify-between gap-2 border-b border-hairline px-3">
        <InstrumentLabel>Create new index</InstrumentLabel>
        <InstrumentLabel>
          {backendInfo.label} · up to{" "}
          <span className="font-mono tabular-nums">{form.maxDimension.toLocaleString()}</span>{" "}
          dimensions
        </InstrumentLabel>
      </div>
      <div className="p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label="Index name">
              <TextInput
                value={form.createForm.name}
                onChange={(event) => form.setName(event.target.value)}
                placeholder="research-vault"
                className="font-mono"
              />
            </Field>
          </div>
          {form.supportsSparse ? (
            <Field label="Vector type">
              <Select
                value={form.createForm.vector_type ?? "dense"}
                onChange={(event) => form.handleVectorTypeChange(event.target.value)}
              >
                <option value="dense">Dense</option>
                <option value="sparse">Sparse</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Metric">
            {isDense ? (
              <Select
                value={form.createForm.metric ?? "cosine"}
                onChange={(event) => form.setMetric(event.target.value)}
              >
                {form.metricOptions.map((metric) => (
                  <option key={metric} value={metric}>
                    {metric}
                  </option>
                ))}
              </Select>
            ) : (
              // Sparse indexes are dot-product by construction — stated, not
              // offered, so the form can't imply a choice the backend won't take.
              <p className="rounded-control border border-hairline bg-surface px-3 py-2 font-mono text-ui text-body">
                dotproduct
              </p>
            )}
          </Field>
          {isDense ? (
            <div className="md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <InstrumentLabel>Dimension</InstrumentLabel>
                    {form.useModelDimension && form.selectedEmbeddingModel?.dimension ? (
                      <Chip tone="accent" dot={false}>
                        {form.selectedEmbeddingModel.dimension.toLocaleString()}d
                      </Chip>
                    ) : null}
                  </div>
                  <p className="mt-0.5 max-w-[66ch] text-ui text-muted">
                    Enter it manually or match an embedding model. Max{" "}
                    <span className="font-mono tabular-nums">
                      {form.maxDimension.toLocaleString()}
                    </span>
                    .
                  </p>
                </div>
                <SegmentedControl
                  aria-label="Dimension source"
                  options={DIMENSION_MODES}
                  value={form.useModelDimension ? "model" : "manual"}
                  onChange={form.handleDimensionModeChange}
                />
              </div>
              {form.useModelDimension ? (
                <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-control border border-hairline bg-surface p-2">
                  <EmbeddingModelSelectorCard
                    models={embeddingModels}
                    selectedModelKey={form.selectedEmbeddingModelId}
                    selectedConnectionId={form.selectedEmbeddingConnectionId}
                    selectedConnectionLabel={form.selectedEmbeddingConnectionLabel}
                    selectedAvailability={form.selectedEmbeddingAvailability}
                    modelsLoading={embeddingModelsLoading}
                    modelsError={embeddingModelsError}
                    connectionErrors={catalogConnectionErrors(embeddingCatalog)}
                    onSelectModel={form.handleSelectEmbeddingModel}
                  />
                </div>
              ) : (
                <TextInput
                  type="number"
                  className="mt-2 font-mono tabular-nums"
                  aria-label="Dimension"
                  value={form.createForm.dimension ?? ""}
                  max={form.maxDimension}
                  onChange={(event) =>
                    form.setDimension(event.target.value ? Number(event.target.value) : undefined)
                  }
                  placeholder="1536"
                />
              )}
            </div>
          ) : null}
          {form.supportsCloudPlacement ? (
            <>
              <Field label="Cloud">
                <Select
                  value={form.createForm.cloud ?? "aws"}
                  onChange={(event) => form.handleCloudChange(event.target.value)}
                >
                  {CLOUD_OPTIONS.map((cloud) => (
                    <option key={cloud} value={cloud}>
                      {cloud}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Region">
                <Select
                  value={form.createForm.region ?? ""}
                  onChange={(event) => form.setRegion(event.target.value)}
                >
                  {(REGION_OPTIONS[form.createForm.cloud ?? "aws"] ?? []).map((region) => (
                    <option key={region} value={region}>
                      {region}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
        </div>
        {form.createDisabledReason ? (
          <p className="mt-3 max-w-[66ch] text-ui text-muted">{form.createDisabledReason}</p>
        ) : null}
        <Button
          onClick={form.handleCreate}
          loading={form.creating}
          className="mt-3"
          disabled={form.createDisabled}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create index
        </Button>
      </div>
    </Panel>
  );
}
