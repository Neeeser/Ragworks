"use client";

import { useEffect, useMemo, useState } from "react";

import { CollectionsList } from "@/components/collections/list/CollectionsList";
import { CreateCollectionWizard } from "@/components/collections/list/CreateCollectionWizard";
import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Notification } from "@/components/ui/notification";
import {
  deleteCollection,
  fetchCollectionStats,
  fetchCollections,
  fetchPipelines,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

import type { Collection, CollectionStats, Pipeline } from "@/lib/types";

export default function CollectionsPage() {
  const { token } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [statsById, setStatsById] = useState<Record<string, CollectionStats>>({});
  const [ingestionPipelines, setIngestionPipelines] = useState<Pipeline[]>([]);
  const [retrievalPipelines, setRetrievalPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  /** Success toast — `message` is the error channel and renders in the error colour. */
  const [notice, setNotice] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Collection | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) {
      setCollections([]);
      setStatsById({});
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function loadCollections() {
      setLoading(true);
      setMessage(null);
      try {
        const [data, stats] = await Promise.all([
          fetchCollections(authToken),
          fetchCollectionStats(authToken),
        ]);
        if (cancelled) return;
        setCollections(data);
        const statsMap: Record<string, CollectionStats> = {};
        stats.forEach((entry) => {
          statsMap[entry.collection_id] = entry;
        });
        setStatsById(statsMap);
      } catch (error) {
        if (!cancelled) {
          setMessage(getErrorMessage(error, "Unable to load collections."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCollections();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;

    async function loadPipelines() {
      try {
        const [ingestion, retrieval] = await Promise.all([
          fetchPipelines(authToken, "ingestion"),
          fetchPipelines(authToken, "retrieval"),
        ]);
        if (cancelled) return;
        setIngestionPipelines(ingestion);
        setRetrievalPipelines(retrieval);
      } catch (error) {
        if (!cancelled) {
          setMessage(getErrorMessage(error, "Unable to load pipelines."));
        }
      }
    }

    loadPipelines();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const statsDefaults = useMemo<CollectionStats>(
    () => ({
      collection_id: "",
      document_count: 0,
      chunk_count: 0,
      average_latency_ms: null,
      last_used_at: null,
    }),
    [],
  );

  const handleCreated = (collection: Collection) => {
    setCollections((prev) => [collection, ...prev]);
    setStatsById((prev) => ({
      ...prev,
      [collection.id]: { ...statsDefaults, collection_id: collection.id },
    }));
    setNotice("Collection created.");
  };

  const handleDelete = async () => {
    if (!deleteTarget || !token) return;
    setDeleting(true);
    setMessage(null);
    try {
      await deleteCollection(token, deleteTarget.id);
      setCollections((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      setStatsById((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      setNotice("Collection deleted.");
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to delete collection."));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const totals = useMemo(() => {
    let documents = 0;
    let chunks = 0;
    for (const collection of collections) {
      const stats = statsById[collection.id];
      documents += stats?.document_count ?? 0;
      chunks += stats?.chunk_count ?? 0;
    }
    return { documents, chunks };
  }, [collections, statsById]);

  return (
    <>
      <CrumbBar
        crumbs={[{ label: "Collections" }]}
        state={
          loading ? null : (
            <InstrumentLabel>
              {`${collections.length} ${collections.length === 1 ? "collection" : "collections"} · ${totals.documents.toLocaleString()} docs · ${totals.chunks.toLocaleString()} chunks`}
            </InstrumentLabel>
          )
        }
        actions={
          <Button size="sm" glow onClick={() => setWizardOpen(true)}>
            New collection
          </Button>
        }
      />

      <PageBody className="relative">
        {notice && (
          <div className="absolute left-1/2 top-3 z-20 w-[min(520px,90%)] -translate-x-1/2">
            <Notification message={notice} onDismiss={() => setNotice(null)} />
          </div>
        )}

        {message && <p className="mb-3 text-ui text-data-neg">{message}</p>}

        <CollectionsList
          collections={collections}
          statsById={statsById}
          loading={loading}
          onDeleteRequest={(collection) => setDeleteTarget(collection)}
          onCreateRequest={() => setWizardOpen(true)}
        />
      </PageBody>

      <CreateCollectionWizard
        open={wizardOpen}
        token={token ?? ""}
        ingestionPipelines={ingestionPipelines}
        retrievalPipelines={retrievalPipelines}
        onClose={() => setWizardOpen(false)}
        onCreated={handleCreated}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${deleteTarget?.name ?? "collection"}?`}
        description="This permanently removes the collection and its indexed data."
        confirmLabel="Delete collection"
        confirmVariant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
