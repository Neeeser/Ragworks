"use client";

import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmbeddingModelSelectorCard } from "@/components/pipelines/EmbeddingModelSelectorCard";
import { sortIndexesByName } from "@/components/pipelines/pipeline-utils";
import { Button } from "@/components/ui/button";
import { Notification } from "@/components/ui/notification";
import { GlassCard } from "@/components/ui/panel";
import { createPineconeIndex, deletePineconeIndex } from "@/lib/api";

import type { EmbeddingModelInfo, PineconeIndex, PineconeIndexCreatePayload } from "@/lib/types";

type IndexManagerModalProps = {
  open: boolean;
  token: string;
  indexes: PineconeIndex[];
  embeddingModels: EmbeddingModelInfo[];
  embeddingModelsLoading?: boolean;
  embeddingModelsError?: string | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onRefresh: () => void;
};

const METRIC_OPTIONS = ["cosine", "euclidean", "dotproduct"];
const CLOUD_OPTIONS = ["aws", "gcp", "azure"];
const REGION_OPTIONS: Record<string, string[]> = {
  aws: ["us-east-1", "us-west-2", "eu-west-1"],
  gcp: ["us-central1", "us-east1", "europe-west1"],
  azure: ["eastus", "westeurope", "southeastasia"],
};

export function IndexManagerModal({
  open,
  token,
  indexes,
  embeddingModels,
  embeddingModelsLoading = false,
  embeddingModelsError = null,
  loading = false,
  error = null,
  onClose,
  onRefresh,
}: IndexManagerModalProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<PineconeIndexCreatePayload>({
    name: "",
    vector_type: "dense",
    dimension: 1536,
    metric: "cosine",
    cloud: "aws",
    region: "us-east-1",
    deletion_protection: "disabled",
  });
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"details" | "create">("details");
  const [useModelDimension, setUseModelDimension] = useState(false);
  const [selectedEmbeddingModelId, setSelectedEmbeddingModelId] = useState("");

  const sortedIndexes = useMemo(() => sortIndexesByName(indexes), [indexes]);
  const selectedIndex = sortedIndexes.find((index) => index.name === selectedName) ?? null;
  const selectedEmbeddingModel =
    embeddingModels.find((model) => model.id === selectedEmbeddingModelId) ?? null;
  const dimensionValid =
    createForm.vector_type === "sparse" ||
    (typeof createForm.dimension === "number" && createForm.dimension > 0);
  const createDisabled =
    !createForm.name.trim() || !dimensionValid || (useModelDimension && !selectedEmbeddingModelId);
  const createDisabledReason = !createForm.name.trim()
    ? "Enter an index name to continue."
    : createForm.vector_type === "dense" && useModelDimension && !selectedEmbeddingModelId
      ? "Select an embedding model to set the dimension."
      : createForm.vector_type === "dense" && !dimensionValid
        ? "Enter a dimension to create a dense index."
        : null;

  useEffect(() => {
    if (!open) return;
    if (viewMode === "details" && !selectedName && sortedIndexes.length > 0) {
      setSelectedName(sortedIndexes[0].name);
    }
  }, [open, selectedName, sortedIndexes, viewMode]);

  useEffect(() => {
    if (!open) return;
    setViewMode(sortedIndexes.length > 0 ? "details" : "create");
  }, [open, sortedIndexes.length]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleteTarget) {
        setDeleteTarget(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteTarget, open, onClose]);

  if (!open) return null;

  const handleCreate = async () => {
    setCreating(true);
    setNotificationMessage(null);
    setLocalError(null);
    try {
      const payload: PineconeIndexCreatePayload = {
        ...createForm,
        name: createForm.name.trim(),
      };
      if (payload.vector_type === "sparse") {
        delete payload.dimension;
      } else if (!payload.dimension) {
        /* c8 ignore start -- guarded by disabled Create button */
        setLocalError("Dense indexes require a vector dimension.");
        setCreating(false);
        return;
      }
      /* c8 ignore stop */
      if (useModelDimension && !selectedEmbeddingModelId) {
        /* c8 ignore start -- guarded by disabled Create button */
        setLocalError("Select an embedding model to set the dimension.");
        setCreating(false);
        return;
      }
      /* c8 ignore stop */
      await createPineconeIndex(token, payload);
      setCreateForm((prev) => ({ ...prev, name: "" }));
      onRefresh();
      setNotificationMessage("Index created.");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Unable to create index.");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (indexName: string) => {
    setDeleting(true);
    setNotificationMessage(null);
    setLocalError(null);
    try {
      await deletePineconeIndex(token, indexName);
      setDeleteConfirm("");
      setDeleteTarget(null);
      onRefresh();
      setSelectedName(null);
      setNotificationMessage("Index deletion requested.");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Unable to delete index.");
    } finally {
      setDeleting(false);
    }
  };

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

  const handleSelectIndex = (name: string) => {
    setSelectedName(name);
    setViewMode("details");
  };

  const handleSelectCreate = () => {
    setViewMode("create");
    setSelectedName(null);
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

  const handleSelectEmbeddingModel = (modelId: string) => {
    setSelectedEmbeddingModelId(modelId);
    const model = embeddingModels.find((entry) => entry.id === modelId);
    if (typeof model?.dimension === "number") {
      setCreateForm((prev) => ({ ...prev, dimension: model.dimension }));
    }
  };

  const handleStartDelete = (name: string) => {
    setDeleteConfirm("");
    setDeleteTarget(name);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <GlassCard
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-6xl max-h-[calc(100vh-4rem)] flex-col rounded-[2.5rem] border border-white/10 bg-slate-950/95 p-6 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        {notificationMessage ? (
          <Notification
            message={notificationMessage}
            onDismiss={() => setNotificationMessage(null)}
            className="absolute right-6 top-6 z-10"
          />
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Manage indexes</p>
            <h2 className="mt-2 text-2xl font-semibold">Pinecone index manager</h2>
            <p className="text-sm text-slate-400">
              Create, review, and delete serverless indexes tied to this API key.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto pr-2">
          {localError ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              {localError}
            </div>
          ) : null}
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Indexes</p>
              <div className="space-y-2">
                {loading ? (
                  <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                    Loading indexes...
                  </p>
                ) : sortedIndexes.length === 0 ? (
                  <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                    No indexes found.
                  </p>
                ) : (
                  sortedIndexes.map((index) => {
                    const isActive = viewMode === "details" && index.name === selectedName;
                    return (
                      <button
                        key={index.name}
                        type="button"
                        onClick={() => handleSelectIndex(index.name)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                          isActive
                            ? "border-violet-400 bg-violet-500/10 text-white"
                            : "border-white/10 bg-white/5 text-slate-300 hover:border-white/30"
                        }`}
                      >
                        <div className="font-semibold">{index.name}</div>
                        <div className="text-xs text-slate-400">
                          {index.vector_type ?? "dense"} · {index.metric ?? "cosine"}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              <Button
                variant={viewMode === "create" ? "primary" : "secondary"}
                onClick={handleSelectCreate}
                className="w-full inline-flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Create index
              </Button>
            </div>

            <div className="space-y-6">
              {viewMode === "details" ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      Index details
                    </p>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 p-2 text-slate-300 transition hover:border-rose-400/60 hover:text-rose-200 disabled:opacity-40"
                      onClick={() => selectedIndex && handleStartDelete(selectedIndex.name)}
                      disabled={!selectedIndex}
                      aria-label="Delete index"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {selectedIndex ? (
                    <div className="mt-4 grid gap-4 text-sm text-slate-200 md:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Name</p>
                        <p className="text-base font-semibold text-white">{selectedIndex.name}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Status</p>
                        <p className="text-sm text-slate-200">
                          {(selectedIndex.status as { state?: string } | null)?.state ?? "Unknown"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                          Vector type
                        </p>
                        <p className="text-sm text-slate-200">
                          {selectedIndex.vector_type ?? "dense"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                          Dimension
                        </p>
                        <p className="text-sm text-slate-200">{selectedIndex.dimension ?? "n/a"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Metric</p>
                        <p className="text-sm text-slate-200">{selectedIndex.metric ?? "cosine"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Host</p>
                        <p className="text-xs text-slate-300 break-all">
                          {selectedIndex.host ?? "Not available"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">Select an index to see details.</p>
                  )}
                </div>
              ) : (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Create new index
                  </p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Index name
                      </label>
                      <input
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                        value={createForm.name}
                        onChange={(event) =>
                          setCreateForm((prev) => ({ ...prev, name: event.target.value }))
                        }
                        placeholder="research-vault"
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Vector type
                      </label>
                      <select
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                        value={createForm.vector_type ?? "dense"}
                        onChange={(event) => handleVectorTypeChange(event.target.value)}
                      >
                        <option value="dense">Dense</option>
                        <option value="sparse">Sparse</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Metric
                      </label>
                      {createForm.vector_type === "sparse" ? (
                        <div className="mt-2 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-200">
                          dotproduct
                        </div>
                      ) : (
                        <select
                          className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                          value={createForm.metric ?? "cosine"}
                          onChange={(event) =>
                            setCreateForm((prev) => ({ ...prev, metric: event.target.value }))
                          }
                        >
                          {METRIC_OPTIONS.map((metric) => (
                            <option key={metric} value={metric}>
                              {metric}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {createForm.vector_type === "dense" ? (
                      <div className="md:col-span-2">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                                Dimension
                              </p>
                              {useModelDimension && selectedEmbeddingModel?.dimension ? (
                                <span className="rounded-full border border-violet-400/40 bg-violet-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-violet-200">
                                  Dim {selectedEmbeddingModel.dimension.toLocaleString()}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-slate-400">
                              Enter it manually or match an embedding model.
                            </p>
                          </div>
                          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 text-[11px] uppercase tracking-[0.3em] text-slate-400">
                            <button
                              type="button"
                              onClick={() => handleDimensionModeChange("manual")}
                              className={`rounded-full px-3 py-1 transition ${
                                useModelDimension
                                  ? "text-slate-400 hover:text-white"
                                  : "bg-violet-500/30 text-white"
                              }`}
                            >
                              Manual
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDimensionModeChange("model")}
                              className={`rounded-full px-3 py-1 transition ${
                                useModelDimension
                                  ? "bg-violet-500/30 text-white"
                                  : "text-slate-400 hover:text-white"
                              }`}
                            >
                              From model
                            </button>
                          </div>
                        </div>
                        {useModelDimension ? (
                          <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-3">
                            <EmbeddingModelSelectorCard
                              models={embeddingModels}
                              selectedModelKey={selectedEmbeddingModelId}
                              modelsLoading={embeddingModelsLoading}
                              modelsError={embeddingModelsError}
                              onSelectModel={handleSelectEmbeddingModel}
                            />
                          </div>
                        ) : (
                          <input
                            type="number"
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                            value={createForm.dimension ?? ""}
                            onChange={(event) =>
                              setCreateForm((prev) => ({
                                ...prev,
                                dimension: event.target.value
                                  ? Number(event.target.value)
                                  : undefined,
                              }))
                            }
                            placeholder="1536"
                          />
                        )}
                      </div>
                    ) : null}
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Cloud
                      </label>
                      <select
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                        value={createForm.cloud ?? "aws"}
                        onChange={(event) => handleCloudChange(event.target.value)}
                      >
                        {CLOUD_OPTIONS.map((cloud) => (
                          <option key={cloud} value={cloud}>
                            {cloud}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Region
                      </label>
                      <select
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                        value={createForm.region ?? ""}
                        onChange={(event) =>
                          setCreateForm((prev) => ({ ...prev, region: event.target.value }))
                        }
                      >
                        {(REGION_OPTIONS[createForm.cloud ?? "aws"] ?? []).map((region) => (
                          <option key={region} value={region}>
                            {region}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {createDisabledReason ? (
                    <p className="mt-3 text-xs text-slate-400">{createDisabledReason}</p>
                  ) : null}
                  <Button
                    onClick={handleCreate}
                    loading={creating}
                    className={`mt-4 flex items-center gap-2 ${createDisabled ? "opacity-50" : ""}`}
                    disabled={createDisabled}
                  >
                    <Plus className="h-4 w-4" />
                    Create index
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </GlassCard>
      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-10 backdrop-blur-sm"
          role="presentation"
          onClick={(event) => {
            event.stopPropagation();
            setDeleteTarget(null);
          }}
        >
          <GlassCard
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-slate-950/95 p-6 text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Delete index</p>
            <h3 className="mt-2 text-xl font-semibold">Confirm index deletion</h3>
            <p className="mt-3 text-sm text-slate-300">
              This will permanently delete this index, and any collections that use it will have
              their data lost.
            </p>
            <p className="mt-3 text-sm text-slate-200">
              Type <span className="font-semibold">{deleteTarget}</span> to confirm.
            </p>
            <input
              className="mt-3 w-full rounded-2xl border border-rose-500/40 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none"
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              placeholder="Enter index name to confirm"
            />
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => handleDelete(deleteTarget)}
                loading={deleting}
                disabled={deleteConfirm !== deleteTarget}
                className={deleteConfirm !== deleteTarget ? "opacity-50" : ""}
              >
                Delete index
              </Button>
            </div>
          </GlassCard>
        </div>
      ) : null}
    </div>
  );
}
