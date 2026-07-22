"use client";

import { useEffect, useState } from "react";

import { fetchCollectionQueryArguments, runCollectionQuery } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { getErrorMessage } from "@/lib/errors";
import {
  isRetrievalFailure,
  type CollectionQueryArgument,
  type CollectionQueryResult,
  type RetrievalFailureDetail,
} from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

const RECENT_LIMIT = 5;

export type QueryArgumentValues = Record<string, number | string | boolean>;

const recentKey = (collectionId: string) => `ragworks:recent-queries:${collectionId}`;
const lastResultKey = (collectionId: string) => `ragworks:last-search:${collectionId}`;

function readRecent(collectionId: string): string[] {
  try {
    const raw = window.localStorage.getItem(recentKey(collectionId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
}

type StoredSearch = {
  query: string;
  topK: number;
  argumentValues?: QueryArgumentValues;
  result: CollectionQueryResult;
};

/** The last completed search, kept for this tab so Back from a trace restores it. */
function readLastSearch(collectionId: string): StoredSearch | null {
  try {
    const raw = window.sessionStorage.getItem(lastResultKey(collectionId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredSearch).query === "string" &&
      typeof (parsed as StoredSearch).topK === "number" &&
      typeof (parsed as StoredSearch).result === "object"
    ) {
      return parsed as StoredSearch;
    }
    return null;
  } catch {
    return null;
  }
}

function writeLastSearch(collectionId: string, stored: StoredSearch): void {
  try {
    window.sessionStorage.setItem(lastResultKey(collectionId), JSON.stringify(stored));
  } catch {
    // Restoring results is a convenience; storage being unavailable is fine.
  }
}

export type CollectionSearchState = {
  query: string;
  setQuery: (query: string) => void;
  topK: number;
  setTopK: (topK: number) => void;
  /** The retrieval pipeline's declared arguments; empty = legacy top_k control. */
  argumentsSpec: CollectionQueryArgument[];
  /** True once the declared-arguments spec has loaded — controls render then. */
  argumentsReady: boolean;
  /** Spec load failure; queries fall back to the legacy top_k field. */
  argumentsError: string | null;
  argumentValues: QueryArgumentValues;
  setArgumentValue: (name: string, value: number | string | boolean | undefined) => void;
  result: CollectionQueryResult | null;
  running: boolean;
  error: string | null;
  /** Structured, trace-linked detail when the failure was a pipeline error. */
  failure: RetrievalFailureDetail | null;
  recentQueries: string[];
  run: (query?: string) => Promise<void>;
};

/**
 * Query composer state: run retrieval, remember recent queries locally, and
 * restore the last result set when the page remounts in the same tab — so
 * navigating into a trace and back never loses the results being inspected.
 * Pipelines that declare input arguments get one value per declaration
 * (seeded from defaults) sent as the request's `arguments` map; pipelines
 * that declare none keep the legacy `top_k` field.
 */
export function useCollectionSearch(token: string, collectionId: string): CollectionSearchState {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [argumentValues, setArgumentValues] = useState<QueryArgumentValues>({});
  const [result, setResult] = useState<CollectionQueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<RetrievalFailureDetail | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  const argumentsQuery = useApiQuery(
    () => fetchCollectionQueryArguments(token, collectionId),
    [token, collectionId],
  );
  const argumentsSpec = argumentsQuery.data?.arguments ?? [];

  // Seed defaults for newly-seen declarations during render (guarded: only
  // when a declared argument has no value yet and a default exists, so this
  // can't loop). An effect would open a stale window between load and seed.
  const unseeded = argumentsSpec.filter(
    (argument) => !(argument.name in argumentValues) && argument.default != null,
  );
  if (unseeded.length > 0) {
    setArgumentValues((previous) => {
      const next = { ...previous };
      for (const argument of unseeded) {
        if (!(argument.name in next) && argument.default != null) {
          next[argument.name] = argument.default;
        }
      }
      return next;
    });
  }

  const setArgumentValue = (name: string, value: number | string | boolean | undefined) => {
    setArgumentValues((previous) => {
      const next = { ...previous };
      if (value === undefined) {
        delete next[name];
      } else {
        next[name] = value;
      }
      return next;
    });
  };

  // Hydrate recents and the last result set after mount — never read Web
  // Storage during render.
  useEffect(() => {
    setRecentQueries(readRecent(collectionId));
    const stored = readLastSearch(collectionId);
    if (stored) {
      setQuery(stored.query);
      setTopK(stored.topK);
      if (stored.argumentValues) {
        setArgumentValues(stored.argumentValues);
      }
      setResult(stored.result);
    }
  }, [collectionId]);

  const run = async (override?: string) => {
    const text = (override ?? query).trim();
    if (!text || running) return;
    if (override !== undefined) {
      setQuery(override);
    }
    setRunning(true);
    setError(null);
    setFailure(null);
    try {
      const declared = argumentsSpec.length > 0;
      const sentArguments: QueryArgumentValues = {};
      for (const argument of argumentsSpec) {
        const value = argumentValues[argument.name];
        if (value !== undefined) {
          sentArguments[argument.name] = value;
        }
      }
      const response = await runCollectionQuery(
        token,
        collectionId,
        declared ? { query: text, arguments: sentArguments } : { query: text, top_k: topK },
      );
      setResult(response);
      writeLastSearch(collectionId, {
        query: text,
        topK,
        argumentValues: declared ? sentArguments : undefined,
        result: response,
      });
      const nextRecent = [text, ...readRecent(collectionId).filter((q) => q !== text)].slice(
        0,
        RECENT_LIMIT,
      );
      setRecentQueries(nextRecent);
      try {
        window.localStorage.setItem(recentKey(collectionId), JSON.stringify(nextRecent));
      } catch {
        // Recents are a convenience; storage being unavailable is fine.
      }
    } catch (err) {
      if (err instanceof ApiError && isRetrievalFailure(err.rawDetail)) {
        setFailure(err.rawDetail);
        setError(err.rawDetail.message);
      } else {
        setError(getErrorMessage(err, "Query failed."));
      }
    } finally {
      setRunning(false);
    }
  };

  return {
    query,
    setQuery,
    topK,
    setTopK,
    argumentsSpec,
    argumentsReady: argumentsQuery.data !== null,
    argumentsError: argumentsQuery.error,
    argumentValues,
    setArgumentValue,
    result,
    running,
    error,
    failure,
    recentQueries,
    run,
  };
}
