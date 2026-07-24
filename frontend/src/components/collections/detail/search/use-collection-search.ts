"use client";

import { useEffect, useMemo, useState } from "react";

import { invokeCollectionTool, listCollectionTools, runCollectionQuery } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { getErrorMessage } from "@/lib/errors";
import {
  isRetrievalFailure,
  type CollectionQueryArgument,
  type RetrievalFailureDetail,
} from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

import type { CollectionTool, ToolInvocationResponse } from "@/lib/types/tools";

const RECENT_LIMIT = 5;

export type QueryArgumentValues = Record<string, number | string | boolean>;

/** The runner's result: an invocation response, or the legacy query shape
 * (no-tools fallback) widened with a default `chunks` kind. */
export type SearchRunResult = ToolInvocationResponse;

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
  toolId?: string;
  argumentValues?: QueryArgumentValues;
  result: SearchRunResult;
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

function seededDefaults(tool: CollectionTool | null): QueryArgumentValues {
  const seeded: QueryArgumentValues = {};
  for (const argument of tool?.arguments ?? []) {
    if (argument.default != null) {
      seeded[argument.name] = argument.default;
    }
  }
  return seeded;
}

export type CollectionSearchState = {
  query: string;
  setQuery: (query: string) => void;
  topK: number;
  setTopK: (topK: number) => void;
  /** The collection's tool bindings; the runner targets one of them. */
  tools: CollectionTool[];
  selectedTool: CollectionTool | null;
  setSelectedToolId: (bindingId: string) => void;
  /** True once the tools listing has loaded — controls render then. */
  toolsReady: boolean;
  /** Tools load failure; queries fall back to the legacy query endpoint. */
  toolsError: string | null;
  /** The selected tool's declared arguments; empty = legacy top_k control. */
  argumentsSpec: CollectionQueryArgument[];
  argumentValues: QueryArgumentValues;
  setArgumentValue: (name: string, value: number | string | boolean | undefined) => void;
  result: SearchRunResult | null;
  running: boolean;
  error: string | null;
  /** Structured, trace-linked detail when the failure was a pipeline error. */
  failure: RetrievalFailureDetail | null;
  recentQueries: string[];
  run: (query?: string) => Promise<void>;
};

/**
 * Tool-runner state for the search page: pick one of the collection's tool
 * bindings (defaulting to the primary search tool), render its declared
 * argument controls, run it through the invoke endpoint, remember recent
 * queries locally, and restore the last result set when the page remounts in
 * the same tab — so navigating into a trace and back never loses the results
 * being inspected. A collection with no tool bindings (pre-migration or
 * system-provisioned) falls back to the legacy query endpoint.
 */
// eslint-disable-next-line complexity -- one state domain: selection + args + run lifecycle
export function useCollectionSearch(token: string, collectionId: string): CollectionSearchState {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [selectedToolId, setSelectedToolIdState] = useState<string | null>(null);
  const [argumentValues, setArgumentValues] = useState<QueryArgumentValues>({});
  const [seededToolId, setSeededToolId] = useState<string | null>(null);
  const [result, setResult] = useState<SearchRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<RetrievalFailureDetail | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  const toolsQuery = useApiQuery(
    () => listCollectionTools(token, collectionId),
    [token, collectionId],
  );
  const tools = useMemo(() => toolsQuery.data?.tools ?? [], [toolsQuery.data]);

  const selectedTool = useMemo(() => {
    if (tools.length === 0) return null;
    return (
      tools.find((tool) => tool.id === selectedToolId) ??
      tools.find((tool) => tool.is_primary) ??
      tools[0]
    );
  }, [tools, selectedToolId]);

  const argumentsSpec = useMemo(() => selectedTool?.arguments ?? [], [selectedTool]);

  // Seed defaults whenever the effective tool changes, during render (guarded
  // by `seededToolId`, so this can't loop). An effect would open a stale
  // window between selection and seed.
  if (selectedTool && selectedTool.id !== seededToolId) {
    setSeededToolId(selectedTool.id);
    setArgumentValues(seededDefaults(selectedTool));
  }

  const setSelectedToolId = (bindingId: string) => {
    setSelectedToolIdState(bindingId);
  };

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
      if (stored.toolId) {
        setSelectedToolIdState(stored.toolId);
        setSeededToolId(stored.toolId);
      }
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
      let response: SearchRunResult;
      if (selectedTool) {
        response = await invokeCollectionTool(
          token,
          collectionId,
          selectedTool.id,
          declared ? { query: text, arguments: sentArguments } : { query: text, top_k: topK },
        );
      } else {
        // No tool bindings (pre-migration or provisioned collection): the
        // legacy endpoint resolves/scaffolds the primary tool server-side.
        const legacy = await runCollectionQuery(token, collectionId, {
          query: text,
          top_k: topK,
        });
        response = { kind: "chunks", tool_binding_id: "", outputs: {}, ...legacy };
      }
      setResult(response);
      writeLastSearch(collectionId, {
        query: text,
        topK,
        toolId: selectedTool?.id,
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
    tools,
    selectedTool,
    setSelectedToolId,
    toolsReady: toolsQuery.data !== null,
    toolsError: toolsQuery.error,
    argumentsSpec,
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
