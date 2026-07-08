"use client";

import { Plus } from "lucide-react";

import { EmbeddingModelSelectorCard } from "@/components/pipelines/EmbeddingModelSelectorCard";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";

import { CLOUD_OPTIONS, REGION_OPTIONS, useCreateIndexForm } from "./use-create-index-form";

import type { BackendInfo, EmbeddingModelInfo } from "@/lib/types";

type CreateIndexFormProps = {
  token: string;
  backendInfo: BackendInfo;
  embeddingModels: EmbeddingModelInfo[];
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  onCreateStart: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
};

const FIELD_LABEL_CLASS = "text-xs uppercase tracking-[0.3em] text-slate-400";

/** The "create new index" form. Everything the backend constrains — metric
 * options, the dimension ceiling, sparse support, cloud placement — renders
 * from the backend's served capabilities; the coupling logic lives in
 * `useCreateIndexForm` and this component is purely presentational. */
export function CreateIndexForm({
  token,
  backendInfo,
  embeddingModels,
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
    onCreateStart,
    onCreated,
    onError,
  });
  const isDense = !form.supportsSparse || form.createForm.vector_type !== "sparse";

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Create new index</p>
        <p className="text-xs text-slate-400">
          {backendInfo.label} · up to {form.maxDimension.toLocaleString()} dimensions
        </p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Index name" labelClassName={FIELD_LABEL_CLASS}>
            <TextInput
              value={form.createForm.name}
              onChange={(event) => form.setName(event.target.value)}
              placeholder="research-vault"
            />
          </Field>
        </div>
        {form.supportsSparse ? (
          <Field label="Vector type" labelClassName={FIELD_LABEL_CLASS}>
            <Select
              value={form.createForm.vector_type ?? "dense"}
              onChange={(event) => form.handleVectorTypeChange(event.target.value)}
            >
              <option value="dense">Dense</option>
              <option value="sparse">Sparse</option>
            </Select>
          </Field>
        ) : null}
        <Field label="Metric" labelClassName={FIELD_LABEL_CLASS}>
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
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-200">
              dotproduct
            </div>
          )}
        </Field>
        {isDense ? (
          <div className="md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className={FIELD_LABEL_CLASS}>Dimension</p>
                  {form.useModelDimension && form.selectedEmbeddingModel?.dimension ? (
                    <span className="rounded-full border border-violet-400/40 bg-violet-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-violet-200">
                      Dim {form.selectedEmbeddingModel.dimension.toLocaleString()}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Enter it manually or match an embedding model. Max{" "}
                  {form.maxDimension.toLocaleString()}.
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 text-[11px] uppercase tracking-[0.3em] text-slate-400">
                <button
                  type="button"
                  onClick={() => form.handleDimensionModeChange("manual")}
                  className={`rounded-full px-3 py-1 transition ${
                    form.useModelDimension
                      ? "text-slate-400 hover:text-white"
                      : "bg-violet-500/30 text-white"
                  }`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => form.handleDimensionModeChange("model")}
                  className={`rounded-full px-3 py-1 transition ${
                    form.useModelDimension
                      ? "bg-violet-500/30 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  From model
                </button>
              </div>
            </div>
            {form.useModelDimension ? (
              <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-3">
                <EmbeddingModelSelectorCard
                  models={embeddingModels}
                  selectedModelKey={form.selectedEmbeddingModelId}
                  modelsLoading={embeddingModelsLoading}
                  modelsError={embeddingModelsError}
                  onSelectModel={form.handleSelectEmbeddingModel}
                />
              </div>
            ) : (
              <TextInput
                type="number"
                className="mt-2"
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
            <Field label="Cloud" labelClassName={FIELD_LABEL_CLASS}>
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
            <Field label="Region" labelClassName={FIELD_LABEL_CLASS}>
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
        <p className="mt-3 text-xs text-slate-400">{form.createDisabledReason}</p>
      ) : null}
      <Button
        onClick={form.handleCreate}
        loading={form.creating}
        className={`mt-4 flex items-center gap-2 ${form.createDisabled ? "opacity-50" : ""}`}
        disabled={form.createDisabled}
      >
        <Plus className="h-4 w-4" />
        Create index
      </Button>
    </div>
  );
}
