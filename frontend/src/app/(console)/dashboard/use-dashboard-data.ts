"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchCollections, fetchDocuments, listChatSessions, listConnections } from "@/lib/api";
import { getErrorMessage, getRequestId } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

import type { ChatSession, Collection, Document, ProviderConnection } from "@/lib/types";

export type DashboardStats = {
  docCount: number;
  totalChunks: number;
};

/** One collection's failed ingestions. Only collections with at least one appear. */
export type CollectionFailure = {
  collectionId: string;
  name: string;
  failed: number;
};

/**
 * How many provider connections exist, and how many of their stored configs no
 * longer validate. `config_valid: false` means the row still lists but cannot
 * serve models — it is a config check, not a live reachability probe, so nothing
 * built on this may claim the provider is up.
 */
export type ConnectionHealth = {
  total: number;
  invalid: number;
};

/** A failure the user can quote: the message plus the request it came from. */
export type DashboardError = {
  message: string;
  requestId?: string;
};

type UseDashboardDataResult = {
  loading: boolean;
  error: DashboardError | null;
  collections: Collection[];
  sessions: ChatSession[];
  stats: DashboardStats;
  recentDocuments: Document[];
  recentSessions: ChatSession[];
  failures: CollectionFailure[];
  /** Names the collection a cross-collection document row belongs to. */
  collectionNameById: Map<string, string>;
  /** `null` while unknown — the fetch has not resolved, or it failed. */
  connectionHealth: ConnectionHealth | null;
};

const RECENT_DOCUMENT_LIMIT = 5;
const RECENT_SESSION_LIMIT = 5;

/**
 * Owns every overview fetch and the workspace aggregates derived from it.
 *
 * Each source degrades on its own: a single collection's document fetch, the
 * chat-session list, and the connection list all fall back to empty rather than
 * rejecting, so one unreachable source cannot blank the page. Only the
 * collection list is load-bearing enough to surface as the page's error.
 */
export function useDashboardData(): UseDashboardDataResult {
  const { token } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DashboardError | null>(null);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;

    async function load() {
      // Deliberately no `setLoading(true)` here. The auth provider rotates the
      // token every 12 minutes, re-running this effect; flipping back to loading
      // replaced the whole page with placeholders while the values it already had
      // were still correct. `loading` starts true and only ever falls.
      setError(null);
      try {
        // The connection list only feeds the breadcrumb's state, so it must not
        // be able to fail the page: an unknown result renders no state at all,
        // which is why it stays `null` rather than collapsing to zero.
        const [cols, connectionResults] = await Promise.all([
          fetchCollections(authToken),
          listConnections(authToken).catch(() => null),
        ]);
        if (cancelled) return;
        setCollections(cols);
        setConnections(connectionResults);

        // Each collection's document count is fetched independently and in parallel;
        // one collection failing (e.g. a stale/deleted index) shouldn't blank the
        // whole overview, so it falls back to an empty list instead of rejecting.
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
          setError({
            message: getErrorMessage(err, "Unable to load data."),
            requestId: getRequestId(err),
          });
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

  const stats = useMemo<DashboardStats>(() => {
    const docCount = documents.length;
    // `num_chunks` is written in the same step that flips a document to READY,
    // after the pipeline's indexer node ran — so a counted chunk is an indexed one.
    const totalChunks = documents.reduce((sum, doc) => sum + doc.num_chunks, 0);
    return { docCount, totalChunks };
  }, [documents]);

  const recentDocuments = useMemo(
    () =>
      [...documents]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, RECENT_DOCUMENT_LIMIT),
    [documents],
  );

  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, RECENT_SESSION_LIMIT),
    [sessions],
  );

  const collectionNameById = useMemo(
    () =>
      new Map(collections.map((collection): [string, string] => [collection.id, collection.name])),
    [collections],
  );

  /**
   * Failed ingestions per collection. Ordered by count so the worst offender
   * leads, and absent entirely when nothing failed — a zero here would be a
   * tile claiming a problem the workspace does not have.
   */
  const failures = useMemo<CollectionFailure[]>(() => {
    const counts = new Map<string, number>();
    for (const doc of documents) {
      if (doc.status !== "failed") continue;
      counts.set(doc.collection_id, (counts.get(doc.collection_id) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([collectionId, failed]) => ({
        collectionId,
        name: collectionNameById.get(collectionId) ?? collectionId,
        failed,
      }))
      .sort((a, b) => b.failed - a.failed || a.name.localeCompare(b.name));
  }, [documents, collectionNameById]);

  const connectionHealth = useMemo<ConnectionHealth | null>(() => {
    if (connections === null) return null;
    return {
      total: connections.length,
      invalid: connections.filter((connection) => connection.config_valid === false).length,
    };
  }, [connections]);

  return {
    loading,
    error,
    collections,
    sessions,
    stats,
    recentDocuments,
    recentSessions,
    failures,
    collectionNameById,
    connectionHealth,
  };
}
