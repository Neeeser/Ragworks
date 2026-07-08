"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { sortIndexesByName } from "@/components/pipelines/lib/pipeline-utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Notification } from "@/components/ui/notification";
import { GlassCard } from "@/components/ui/panel";
import { deleteIndex } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAppConfig } from "@/providers/config-provider";

import { CreateIndexForm } from "./CreateIndexForm";
import { IndexDetailsPanel } from "./IndexDetailsPanel";
import { IndexListPanel } from "./IndexListPanel";

import type { BackendInfo, EmbeddingModelInfo, IndexBackend, VectorIndex } from "@/lib/types";

type IndexManagerModalProps = {
  open: boolean;
  token: string;
  indexes: VectorIndex[];
  backends: BackendInfo[];
  embeddingModels: EmbeddingModelInfo[];
  embeddingModelsLoading?: boolean;
  embeddingModelsError?: string | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onRefresh: () => void;
};

/**
 * Orchestrates the Pinecone index manager: the index list, the details/create panel
 * switch, and the delete-confirmation flow. The panel components (IndexListPanel,
 * IndexDetailsPanel, CreateIndexForm) are presentational; this component owns the
 * cross-cutting state (selection, view mode, notifications) that ties them together.
 */
export function IndexManagerModal({
  open,
  token,
  indexes,
  backends,
  embeddingModels,
  embeddingModelsLoading = false,
  embeddingModelsError = null,
  loading = false,
  error = null,
  onClose,
  onRefresh,
}: IndexManagerModalProps) {
  const titleId = useId();
  const { config } = useAppConfig();
  const [activeBackend, setActiveBackend] = useState<IndexBackend>(config.indexing.default_backend);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"details" | "create">("details");
  const wasOpenRef = useRef(false);

  const sortedIndexes = sortIndexesByName(
    indexes.filter((index) => index.backend === activeBackend),
  );
  const selectedIndex = sortedIndexes.find((index) => index.name === selectedName) ?? null;
  const activeBackendInfo = backends.find((info) => info.backend === activeBackend) ?? null;

  useEffect(() => {
    if (!open) return;
    if (viewMode === "details" && !selectedName && sortedIndexes.length > 0) {
      setSelectedName(sortedIndexes[0].name);
    }
  }, [open, selectedName, sortedIndexes, viewMode]);

  // Reset the view only on the closed -> open transition, not on every indexes change
  // while the modal stays open. Previously this ran whenever `sortedIndexes.length`
  // changed at all, so creating an index (which bumps the count once `onRefresh`
  // resolves) yanked the user out of the create form and back to the details view.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setViewMode(sortedIndexes.length > 0 ? "details" : "create");
    }
    wasOpenRef.current = open;
  }, [open, sortedIndexes.length]);

  const handleDelete = async (indexName: string) => {
    setDeleting(true);
    setNotificationMessage(null);
    setLocalError(null);
    try {
      await deleteIndex(token, activeBackend, indexName);
      setDeleteTarget(null);
      onRefresh();
      setSelectedName(null);
      setNotificationMessage("Index deletion requested.");
    } catch (err) {
      setLocalError(getErrorMessage(err, "Unable to delete index."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ModalOverlay
        open={open}
        onClose={onClose}
        labelledBy={titleId}
        backdropClassName="bg-slate-950/80 px-4 py-8"
      >
        <GlassCard className="relative flex w-full max-w-6xl max-h-[calc(100vh-4rem)] flex-col rounded-[2.5rem] border border-white/10 bg-slate-950/95 p-6 text-white">
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
              <h2 id={titleId} className="mt-2 text-2xl font-semibold">
                Vector index manager
              </h2>
              <p className="text-sm text-slate-400">
                Create, review, and delete indexes on any configured vector store.
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

          <div
            role="tablist"
            aria-label="Vector store backend"
            className="mt-4 flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 text-sm self-start"
          >
            {backends.map((info) => {
              const usable = info.available && info.configured;
              const isActive = info.backend === activeBackend;
              return (
                <button
                  key={info.backend}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  disabled={!usable}
                  title={
                    usable
                      ? undefined
                      : !info.available
                        ? "Unavailable on this deployment."
                        : "API key required — add it in Settings."
                  }
                  onClick={() => {
                    setActiveBackend(info.backend);
                    setSelectedName(null);
                    const hasIndexes = indexes.some((index) => index.backend === info.backend);
                    setViewMode(hasIndexes ? "details" : "create");
                  }}
                  className={`rounded-full px-4 py-1.5 transition ${
                    isActive
                      ? "bg-violet-500/30 text-white"
                      : "text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  }`}
                >
                  {info.backend === "pgvector" ? "pgvector" : "Pinecone"}
                </button>
              );
            })}
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
              <IndexListPanel
                indexes={sortedIndexes}
                loading={loading}
                viewMode={viewMode}
                selectedName={selectedName}
                onSelectIndex={(name) => {
                  setSelectedName(name);
                  setViewMode("details");
                }}
                onSelectCreate={() => {
                  setViewMode("create");
                  setSelectedName(null);
                }}
              />

              <div className="space-y-6">
                {viewMode === "details" ? (
                  <IndexDetailsPanel index={selectedIndex} onDelete={setDeleteTarget} />
                ) : activeBackendInfo ? (
                  <CreateIndexForm
                    key={activeBackend}
                    token={token}
                    backendInfo={activeBackendInfo}
                    embeddingModels={embeddingModels}
                    embeddingModelsLoading={embeddingModelsLoading}
                    embeddingModelsError={embeddingModelsError}
                    onCreateStart={() => {
                      setNotificationMessage(null);
                      setLocalError(null);
                    }}
                    onCreated={() => {
                      onRefresh();
                      setNotificationMessage("Index created.");
                    }}
                    onError={(nextMessage) => setLocalError(nextMessage)}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </GlassCard>
      </ModalOverlay>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Confirm index deletion"
        description="This will permanently delete this index, and any collections that use it will have their data lost."
        confirmText={deleteTarget ?? undefined}
        confirmLabel="Delete index"
        confirmVariant="danger"
        loading={deleting}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
