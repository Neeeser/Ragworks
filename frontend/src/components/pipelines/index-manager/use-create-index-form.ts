"use client";

import { useState } from "react";

import { createIndex } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { BackendInfo, CatalogModel, IndexCreatePayload } from "@/lib/types";

export const CLOUD_OPTIONS = ["aws", "gcp", "azure"];
export const REGION_OPTIONS: Record<string, string[]> = {
  aws: ["us-east-1", "us-west-2", "eu-west-1"],
  gcp: ["us-central1", "us-east1", "europe-west1"],
  azure: ["eastus", "westeurope", "southeastasia"],
};

type CreateFormState = Omit<IndexCreatePayload, "backend">;

const DEFAULT_FORM: CreateFormState = {
  name: "",
  vector_type: "dense",
  dimension: 1536,
  metric: "cosine",
  cloud: "aws",
  region: "us-east-1",
  deletion_protection: "disabled",
};

interface UseCreateIndexFormParams {
  token: string;
  /** The backend the form creates on; its capabilities drive metric options,
   * the dimension ceiling, and which Pinecone-only fields render at all. */
  backendInfo: BackendInfo;
  embeddingModels: CatalogModel[];
  /** Called at the start of every create attempt, before any validation or the API
   * call - the parent uses it to clear stale success/error banners so a retry never
   * shows a leftover error next to a fresh result. */
  onCreateStart: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}

export interface UseCreateIndexFormResult {
  createForm: CreateFormState;
  creating: boolean;
  useModelDimension: boolean;
  selectedEmbeddingModelId: string;
  selectedEmbeddingModel: CatalogModel | null;
  createDisabled: boolean;
  createDisabledReason: string | null;
  metricOptions: string[];
  supportsSparse: boolean;
  supportsCloudPlacement: boolean;
  maxDimension: number;
  setName: (value: string) => void;
  setMetric: (value: string) => void;
  setRegion: (value: string) => void;
  setDimension: (value: number | undefined) => void;
  handleVectorTypeChange: (value: string) => void;
  handleCloudChange: (value: string) => void;
  handleDimensionModeChange: (mode: "manual" | "model") => void;
  handleSelectEmbeddingModel: (model: CatalogModel) => void;
  handleCreate: () => Promise<void>;
}

/**
 * Owns the create-index form's vector-type/cloud/dimension coupling: switching to a
 * sparse index clears the dimension and forces the "dotproduct" metric; switching cloud
 * resets the region to that cloud's first option; and toggling "from model" pulls the
 * dimension from the selected embedding model instead of a manually-typed number.
 * Limits come from the backend's capabilities (served by the API), never hardcoded:
 * the dimension ceiling and metric list follow whichever backend is selected.
 * Also owns the create submission itself, reporting success/failure via the
 * `onCreated`/`onError` callbacks rather than local UI state.
 */
export function useCreateIndexForm({
  token,
  backendInfo,
  embeddingModels,
  onCreateStart,
  onCreated,
  onError,
}: UseCreateIndexFormParams): UseCreateIndexFormResult {
  const [createForm, setCreateForm] = useState<CreateFormState>({ ...DEFAULT_FORM });
  const [creating, setCreating] = useState(false);
  const [useModelDimension, setUseModelDimension] = useState(false);
  const [selectedEmbeddingModelId, setSelectedEmbeddingModelId] = useState("");

  const { capabilities, backend } = backendInfo;
  const metricOptions = capabilities.supported_metrics;
  const supportsSparse = capabilities.supported_vector_types.includes("sparse");
  // Cloud/region placement is a Pinecone-only concept; pgvector lives in the
  // deployment's own Postgres.
  const supportsCloudPlacement = backend === "pinecone";
  const maxDimension = capabilities.max_dimension;

  const effectiveVectorType = supportsSparse ? (createForm.vector_type ?? "dense") : "dense";
  const selectedEmbeddingModel =
    embeddingModels.find((model) => model.id === selectedEmbeddingModelId) ?? null;
  const dimensionValid =
    effectiveVectorType === "sparse" ||
    (typeof createForm.dimension === "number" &&
      createForm.dimension > 0 &&
      createForm.dimension <= maxDimension);
  const dimensionOverMax =
    typeof createForm.dimension === "number" && createForm.dimension > maxDimension;
  const createDisabled =
    !createForm.name.trim() || !dimensionValid || (useModelDimension && !selectedEmbeddingModelId);
  const createDisabledReason = !createForm.name.trim()
    ? "Enter an index name to continue."
    : effectiveVectorType === "dense" && useModelDimension && !selectedEmbeddingModelId
      ? "Select an embedding model to set the dimension."
      : effectiveVectorType === "dense" && dimensionOverMax
        ? `${backendInfo.label} supports up to ${maxDimension.toLocaleString()} dimensions.`
        : effectiveVectorType === "dense" && !dimensionValid
          ? "Enter a dimension to create a dense index."
          : null;

  const setName = (value: string) => setCreateForm((prev) => ({ ...prev, name: value }));
  const setMetric = (value: string) => setCreateForm((prev) => ({ ...prev, metric: value }));
  const setRegion = (value: string) => setCreateForm((prev) => ({ ...prev, region: value }));
  const setDimension = (value: number | undefined) =>
    setCreateForm((prev) => ({ ...prev, dimension: value }));

  const handleVectorTypeChange = (value: string) => {
    setCreateForm((prev) => {
      if (value === "sparse") {
        return { ...prev, vector_type: value, dimension: undefined, metric: "dotproduct" };
      }
      return {
        ...prev,
        vector_type: value,
        dimension: prev.dimension ?? 1536,
        metric: "cosine",
      };
    });
    if (value === "sparse") {
      setUseModelDimension(false);
      setSelectedEmbeddingModelId("");
    }
  };

  const handleCloudChange = (value: string) => {
    const regions = REGION_OPTIONS[value] ?? [];
    setCreateForm((prev) => ({
      ...prev,
      cloud: value,
      region: regions[0] ?? "",
    }));
  };

  const handleDimensionModeChange = (mode: "manual" | "model") => {
    const useModel = mode === "model";
    setUseModelDimension(useModel);
    if (useModel) {
      const model = embeddingModels.find((entry) => entry.id === selectedEmbeddingModelId);
      setCreateForm((prev) => ({
        ...prev,
        dimension: typeof model?.dimension === "number" ? model.dimension : undefined,
      }));
      return;
    }
    setCreateForm((prev) => ({
      ...prev,
      dimension: typeof prev.dimension === "number" ? prev.dimension : 1536,
    }));
  };

  const handleSelectEmbeddingModel = (model: CatalogModel) => {
    setSelectedEmbeddingModelId(model.id);
    if (typeof model.dimension === "number") {
      const dimension = model.dimension;
      setCreateForm((prev) => ({ ...prev, dimension }));
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    onCreateStart();
    try {
      const payload: IndexCreatePayload = {
        ...createForm,
        backend,
        name: createForm.name.trim(),
        vector_type: effectiveVectorType,
      };
      if (!supportsCloudPlacement) {
        delete payload.cloud;
        delete payload.region;
        delete payload.deletion_protection;
      }
      if (payload.vector_type === "sparse") {
        delete payload.dimension;
      } else if (!payload.dimension) {
        /* c8 ignore start -- guarded by disabled Create button */
        onError("Dense indexes require a vector dimension.");
        setCreating(false);
        return;
        /* c8 ignore stop */
      }
      if (useModelDimension && !selectedEmbeddingModelId) {
        /* c8 ignore start -- guarded by disabled Create button */
        onError("Select an embedding model to set the dimension.");
        setCreating(false);
        return;
        /* c8 ignore stop */
      }
      await createIndex(token, payload);
      setCreateForm((prev) => ({ ...prev, name: "" }));
      onCreated();
    } catch (err) {
      onError(getErrorMessage(err, "Unable to create index."));
    } finally {
      setCreating(false);
    }
  };

  return {
    createForm,
    creating,
    useModelDimension,
    selectedEmbeddingModelId,
    selectedEmbeddingModel,
    createDisabled,
    createDisabledReason,
    metricOptions,
    supportsSparse,
    supportsCloudPlacement,
    maxDimension,
    setName,
    setMetric,
    setRegion,
    setDimension,
    handleVectorTypeChange,
    handleCloudChange,
    handleDimensionModeChange,
    handleSelectEmbeddingModel,
    handleCreate,
  };
}
