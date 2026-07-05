"use client";

import { useEffect, useState } from "react";

import { CollectionDocuments } from "@/components/collections/detail/CollectionDocuments";
import { CollectionOverview } from "@/components/collections/detail/CollectionOverview";
import { CollectionSearch } from "@/components/collections/detail/CollectionSearch";
import {
  CollectionSidebar,
  type CollectionView,
} from "@/components/collections/detail/CollectionSidebar";
import { CollectionVisualization } from "@/components/collections/detail/visualize/CollectionVisualization";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { fetchCollection, fetchCollectionStatsById, fetchPipelines } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

import type { Collection, CollectionStats, Pipeline } from "@/lib/types";

type CollectionDetailProps = {
  collectionId: string;
};

export function CollectionDetail({ collectionId }: CollectionDetailProps) {
  const { token } = useAuth();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [ingestionPipelines, setIngestionPipelines] = useState<Pipeline[]>([]);
  const [retrievalPipelines, setRetrievalPipelines] = useState<Pipeline[]>([]);
  const [activeView, setActiveView] = useState<CollectionView>("overview");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) {
      setMessage("Sign in to view this collection.");
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function loadCollection() {
      setLoading(true);
      setMessage(null);
      try {
        const [collectionData, statsData, ingestion, retrieval] = await Promise.all([
          fetchCollection(authToken, collectionId),
          fetchCollectionStatsById(authToken, collectionId),
          fetchPipelines(authToken, "ingestion"),
          fetchPipelines(authToken, "retrieval"),
        ]);
        if (cancelled) return;
        setCollection(collectionData);
        setStats(statsData);
        setIngestionPipelines(ingestion);
        setRetrievalPipelines(retrieval);
      } catch (error) {
        if (!cancelled) {
          setMessage(getErrorMessage(error, "Unable to load collection."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCollection();
    return () => {
      cancelled = true;
    };
  }, [collectionId, token]);

  if (loading) {
    return (
      <GlassCard className="flex items-center justify-center rounded-3xl p-10">
        <Loader className="h-6 w-6" />
      </GlassCard>
    );
  }

  if (!collection || !token) {
    return (
      <GlassCard className="rounded-3xl border border-white/10 p-6 text-sm text-slate-300">
        {message || "Collection not available."}
      </GlassCard>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <CollectionSidebar
        collection={collection}
        activeView={activeView}
        onSelectView={setActiveView}
      />
      <div className="space-y-6">
        {message && (
          <GlassCard className="rounded-3xl border border-white/10 p-4 text-sm text-slate-200">
            {message}
          </GlassCard>
        )}
        {activeView === "overview" && (
          <CollectionOverview
            collection={collection}
            stats={stats}
            ingestionPipelines={ingestionPipelines}
            retrievalPipelines={retrievalPipelines}
            token={token}
            onCollectionUpdated={setCollection}
          />
        )}
        {activeView === "search" && <CollectionSearch collectionId={collection.id} token={token} />}
        {activeView === "documents" && (
          <CollectionDocuments collectionId={collection.id} token={token} />
        )}
        {activeView === "visualize" && (
          <CollectionVisualization collectionId={collection.id} token={token} />
        )}
      </div>
    </div>
  );
}
