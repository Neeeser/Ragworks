"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { sortIndexesByName } from "@/components/pipelines/lib/pipeline-utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Notification } from "@/components/ui/notification";
import { GlassCard } from "@/components/ui/panel";
import { deletePineconeIndex } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import { CreateIndexForm } from "./CreateIndexForm";
import { IndexDetailsPanel } from "./IndexDetailsPanel";
import { IndexListPanel } from "./IndexListPanel";

import type { EmbeddingModelInfo, PineconeIndex } from "@/lib/types";

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
  embeddingModels,
  embeddingModelsLoading = false,
  embeddingModelsError = null,
  loading = false,
  error = null,
  onClose,
  onRefresh,
}: IndexManagerModalProps) {
  const titleId = useId();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"details" | "create">("details");
  const wasOpenRef = useRef(false);

  const sortedIndexes = sortIndexesByName(indexes);
  const selectedIndex = sortedIndexes.find((index) => index.name === selectedName) ?? null;

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
      await deletePineconeIndex(token, indexName);
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
                Pinecone index manager
              </h2>
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
                ) : (
                  <CreateIndexForm
                    token={token}
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
                )}
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
