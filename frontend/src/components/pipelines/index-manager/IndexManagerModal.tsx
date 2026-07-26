"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { sortIndexesByName } from "@/components/pipelines/lib/pipeline-utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Notification } from "@/components/ui/notification";
import { TabList } from "@/components/ui/tabs";
import { deleteIndex, registerIndex } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAppConfig } from "@/providers/config-provider";

import { CreateIndexForm } from "./CreateIndexForm";
import { IndexDetailsPanel } from "./IndexDetailsPanel";
import { IndexListPanel } from "./IndexListPanel";

import type { TabItem } from "@/components/ui/tabs";
import type {
  BackendInfo,
  CatalogModel,
  IndexBackend,
  ModelCatalogResponse,
  VectorIndex,
} from "@/lib/types";

type IndexManagerModalProps = {
  open: boolean;
  token: string;
  indexes: VectorIndex[];
  backends: BackendInfo[];
  embeddingModels: CatalogModel[];
  embeddingCatalog?: ModelCatalogResponse | null;
  embeddingModelsLoading?: boolean;
  embeddingModelsError?: string | null;
  loading?: boolean;
  error?: string | null;
  onCatalogVisible?: () => void;
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
  embeddingCatalog = null,
  embeddingModelsLoading = false,
  embeddingModelsError = null,
  loading = false,
  error = null,
  onCatalogVisible,
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
  const [registering, setRegistering] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"details" | "create">("details");
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) onCatalogVisible?.();
  }, [onCatalogVisible, open]);

  const sortedIndexes = sortIndexesByName(
    indexes.filter((index) => index.backend === activeBackend),
  );
  const backendTabs: Array<TabItem<IndexBackend>> = backends.map((info) => ({
    id: info.backend,
    label: info.backend === "pgvector" ? "pgvector" : "Pinecone",
    disabled: !(info.available && info.configured),
    disabledReason: !info.available
      ? "Unavailable on this deployment."
      : info.configured
        ? undefined
        : "API key required — add it in Settings.",
  }));
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

  const handleRegister = async (index: VectorIndex) => {
    setRegistering(true);
    setNotificationMessage(null);
    setLocalError(null);
    try {
      await registerIndex(token, { backend: index.backend, name: index.name });
      onRefresh();
      setNotificationMessage("Index registered.");
    } catch (err) {
      setLocalError(getErrorMessage(err, "Unable to register index."));
    } finally {
      setRegistering(false);
    }
  };

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
        backdropClassName="bg-canvas/80 px-4 py-8"
      >
        <div className="card-surface relative flex max-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col overflow-hidden bg-canvas-raised text-primary shadow-elevation-2">
          {notificationMessage ? (
            <Notification
              message={notificationMessage}
              onDismiss={() => setNotificationMessage(null)}
              className="absolute right-3 top-3 z-10"
            />
          ) : null}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline p-3">
            <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
              Vector index manager
            </h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={onRefresh} disabled={loading}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Refresh
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>

          <TabList<IndexBackend>
            tabs={backendTabs}
            active={activeBackend}
            onSelect={(backend) => {
              setActiveBackend(backend);
              setSelectedName(null);
              setViewMode(
                indexes.some((index) => index.backend === backend) ? "details" : "create",
              );
            }}
            label="Vector store backend"
            wrap
            className="m-3 self-start"
          />

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {localError ? (
              <p role="alert" className="mb-3 max-w-[66ch] text-ui text-data-neg">
                {localError}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mb-3 max-w-[66ch] text-ui text-data-neg">
                {error}
              </p>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
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

              <div className="min-w-0 space-y-3">
                {viewMode === "details" ? (
                  <IndexDetailsPanel
                    index={selectedIndex}
                    onDelete={setDeleteTarget}
                    onRegister={handleRegister}
                    registering={registering}
                  />
                ) : activeBackendInfo ? (
                  <CreateIndexForm
                    key={activeBackend}
                    token={token}
                    backendInfo={activeBackendInfo}
                    embeddingModels={embeddingModels}
                    embeddingCatalog={embeddingCatalog}
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
        </div>
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
