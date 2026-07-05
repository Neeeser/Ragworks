"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchCollections, fetchDocuments, fetchPipelines, listChatSessions } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

import type { ChatSession, Collection, Document, Pipeline } from "@/lib/types";

export type DashboardStats = {
  docCount: number;
  totalChunks: number;
  totalTokens: number;
  contextUtilization: number;
  contextConsumed: number;
  contextCapacity: number;
  avgChunkSize: number;
};

type UseDashboardDataResult = {
  loading: boolean;
  error: string | null;
  collections: Collection[];
  sessions: ChatSession[];
  stats: DashboardStats;
  recentDocuments: Document[];
  activeCollections: Collection[];
  pipelineNameById: Map<string, string>;
};

/** Reads a retrieval pipeline's configured chat context window, defaulting to 0. */
const getContextWindow = (pipeline: Pipeline | null) => {
  if (!pipeline) return 0;
  const node = pipeline.definition.nodes.find((item) => item.type === "chat.settings");
  const value = node?.config?.context_window;
  return typeof value === "number" ? value : 0;
};

const RECENT_DOCUMENT_LIMIT = 5;
const ACTIVE_COLLECTION_LIMIT = 3;

/**
 * Owns every dashboard fetch and the metrics derived from it. Collections, pipelines,
 * and per-collection document counts load in parallel; a single collection's document
 * fetch failing (or the chat-session fetch failing) degrades gracefully instead of
 * sinking the whole dashboard.
 */
export function useDashboardData(): UseDashboardDataResult {
  const { token } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [ingestionPipelines, setIngestionPipelines] = useState<Pipeline[]>([]);
  const [retrievalPipelines, setRetrievalPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [cols, ingestion, retrieval] = await Promise.all([
          fetchCollections(authToken),
          fetchPipelines(authToken, "ingestion"),
          fetchPipelines(authToken, "retrieval"),
        ]);
        if (cancelled) return;
        setCollections(cols);
        setIngestionPipelines(ingestion);
        setRetrievalPipelines(retrieval);

        // Each collection's document count is fetched independently and in parallel;
        // one collection failing (e.g. a stale/deleted index) shouldn't blank the
        // whole dashboard, so it falls back to an empty list instead of rejecting.
        const docResults = await Promise.all(
          cols.map(async (collection) => {
            try {
              return await fetchDocuments(authToken, collection.id);
            } catch {
              return [];
            }
          }),
        );
        if (cancelled) return;
        setDocuments(docResults.flat());

        try {
          const sessionResults = await listChatSessions(authToken);
          if (!cancelled) {
            setSessions(sessionResults);
          }
        } catch {
          if (!cancelled) {
            setSessions([]);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const pipelineNameById = useMemo(() => {
    const entries = [...ingestionPipelines, ...retrievalPipelines].map(
      (pipeline): [string, string] => [pipeline.id, pipeline.name],
    );
    return new Map(entries);
  }, [ingestionPipelines, retrievalPipelines]);

  const defaultRetrieval = useMemo(
    () =>
      retrievalPipelines.find((pipeline) => pipeline.is_default) ?? retrievalPipelines[0] ?? null,
    [retrievalPipelines],
  );

  const stats = useMemo<DashboardStats>(() => {
    const docCount = documents.length;
    const totalChunks = documents.reduce((sum, doc) => sum + doc.num_chunks, 0);
    const totalTokens = documents.reduce((sum, doc) => sum + doc.num_tokens, 0);
    const contextCapacity = collections.reduce((sum, col) => {
      const pipeline =
        retrievalPipelines.find((item) => item.id === col.retrieval_pipeline_id) ||
        defaultRetrieval;
      return sum + getContextWindow(pipeline);
    }, 0);
    const contextConsumed = sessions.reduce((sum, session) => sum + session.context_tokens, 0);
    const contextUtilization = contextCapacity
      ? Math.min(100, Math.round((contextConsumed / contextCapacity) * 100))
      : 0;
    const avgChunkSize =
      documents.length > 0
        ? Math.round(documents.reduce((sum, doc) => sum + doc.chunk_size, 0) / documents.length)
        : 0;

    return {
      docCount,
      totalChunks,
      totalTokens,
      contextUtilization,
      contextConsumed,
      contextCapacity,
      avgChunkSize,
    };
  }, [collections, documents, sessions, retrievalPipelines, defaultRetrieval]);

  const recentDocuments = useMemo(
    () =>
      [...documents]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, RECENT_DOCUMENT_LIMIT),
    [documents],
  );

  const activeCollections = useMemo(
    () => collections.slice(0, ACTIVE_COLLECTION_LIMIT),
    [collections],
  );

  return {
    loading,
    error,
    collections,
    sessions,
    stats,
    recentDocuments,
    activeCollections,
    pipelineNameById,
  };
}
