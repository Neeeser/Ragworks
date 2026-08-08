"use client";

import { useCallback, useMemo, useState } from "react";

import { buildIndexCreatePayload } from "@/components/indexes/create-index";
import { bm25SiblingIndexName } from "@/components/pipelines/lib/pipeline-scaffold";
import { createIndex, listIndexes } from "@/lib/api";
import { defaultIndexName } from "@/lib/default-index-name";
import { useAuth } from "@/providers/auth-provider";

import type { BackendInfo, IndexBackend, VectorIndex } from "@/lib/types";

/** Fallback name cap when the backend's capabilities haven't loaded yet. */
const FALLBACK_NAME_MAX_LENGTH = 45;

export type WizardIndexTargetInput = {
  token: string;
  backend: IndexBackend;
  backendInfo: BackendInfo | null;
  /** False for the tool wizard, which always points at an existing store. */
  offerNew: boolean;
};

export type WizardIndexTarget = {
  /** Whether the pipeline points at a new index or one that already exists. */
  mode: "new" | "existing";
  /** The index name the pipeline will carry, either way. */
  name: string;
  /** Name of the BM25 sibling created alongside a new dense index. */
  bm25Name: string;
  /** True while the new index is being created. */
  creating: boolean;
  setMode: (mode: "new" | "existing") => void;
  /** Type over the suggested name; stops the suggestion re-seeding. */
  setName: (name: string) => void;
  /** Pick an existing index (also used by the tool wizard's select). */
  selectExisting: (name: string) => void;
  /** Clear the selection — a backend or template change invalidates it. */
  clearSelection: () => void;
  /**
   * Create the new index (and its BM25 sibling where the deployment serves
   * one) before the pipeline that writes them is created. A no-op in
   * `existing` mode or when the names are already taken.
   */
  ensureCreated: (dimension: number | null) => Promise<void>;
};

/**
 * Existing indexes the pipeline's vectors cannot go into, and why.
 *
 * A width the model does not state leaves every index usable: an unknown
 * width is not a mismatch, and refusing on one would block the whole store
 * step for every provider that publishes no dimensions.
 */
export function unusableIndexes(
  candidates: VectorIndex[],
  dimension: number | null,
): Map<string, string> {
  const blocked = new Map<string, string>();
  if (dimension === null) return blocked;
  for (const index of candidates) {
    if (typeof index.dimension === "number" && index.dimension !== dimension) {
      blocked.set(
        index.name,
        `stores ${index.dimension.toLocaleString()}d, the model produces ${dimension.toLocaleString()}d`,
      );
    }
  }
  return blocked;
}

/**
 * Which index an ingestion pipeline writes: a suggested new one, or one that
 * already exists.
 *
 * The suggested name is derived per account, never a fixed literal — on
 * pgvector one index name is one physical table for the whole deployment, so
 * a shared default interleaves two accounts' vectors in a store neither can
 * see the whole of. It re-seeds while the backend (and with it the name
 * length cap) changes, and stops the moment the user types their own name.
 *
 * The index is created when the pipeline is, rather than left for the
 * indexer's `ensure_index` to make on first ingest: an index that appears
 * without a registration row is one no other pipeline can be pointed at, and
 * a BM25 sibling arriving unannounced is what users report as confusing.
 */
export function useWizardIndexTarget(input: WizardIndexTargetInput): WizardIndexTarget {
  const { token, backend, backendInfo, offerNew } = input;
  const { user } = useAuth();
  const [mode, setModeState] = useState<"new" | "existing">("new");
  const [name, setNameState] = useState("");
  const [typed, setTyped] = useState(false);
  const [seeded, setSeeded] = useState("");
  const [creating, setCreating] = useState(false);

  const maxLength = backendInfo?.capabilities.index_name_max_length ?? FALLBACK_NAME_MAX_LENGTH;
  const suggestion = useMemo(
    () => (user ? defaultIndexName({ id: user.id, email: user.email }, maxLength) : ""),
    [user, maxLength],
  );

  // A render-time adjustment rather than an effect: the account and the
  // backend's cap both arrive with async loads, and an effect would paint the
  // empty field first.
  const seedKey = `${backend}:${suggestion}`;
  if (offerNew && mode === "new" && !typed && suggestion && seedKey !== seeded) {
    setSeeded(seedKey);
    setNameState(suggestion);
  }

  const setMode = useCallback(
    (next: "new" | "existing") => {
      setModeState(next);
      // Each mode owns its own answer: keeping the other one's name would
      // point the pipeline at a store the visible control no longer names.
      setNameState(next === "new" && !typed ? suggestion : "");
    },
    [suggestion, typed],
  );

  const setName = useCallback((next: string) => {
    setTyped(true);
    setNameState(next);
  }, []);

  const selectExisting = useCallback((next: string) => {
    setModeState("existing");
    setNameState(next);
  }, []);

  const clearSelection = useCallback(() => {
    // An existing index belongs to the backend it was picked on, so it goes.
    // A name the user typed for an index that does not exist yet is theirs
    // whatever the store is; only the wizard's own suggestion is re-derived.
    setSeeded("");
    if (mode === "existing" || !typed) setNameState("");
  }, [mode, typed]);

  const ensureCreated = useCallback(
    async (dimension: number | null) => {
      const target = name.trim();
      if (mode !== "new" || !target) return;
      setCreating(true);
      try {
        const known = new Set((await listIndexes(token)).map((index) => index.name));
        if (!known.has(target)) {
          if (dimension === null) {
            throw new Error(
              "Could not resolve the embedding model's vector width, so the index " +
                "cannot be created. Pick another model, or select an existing index.",
            );
          }
          await createIndex(
            token,
            buildIndexCreatePayload(backend, {
              name: target,
              vector_type: "dense",
              dimension,
              metric: "cosine",
            }),
          );
        }
        const sibling = bm25SiblingIndexName(target, maxLength);
        if (backendInfo?.lexical_available && !known.has(sibling)) {
          await createIndex(
            token,
            buildIndexCreatePayload(backend, { name: sibling, vector_type: "sparse" }),
          );
        }
      } finally {
        setCreating(false);
      }
    },
    [mode, name, token, backend, backendInfo?.lexical_available, maxLength],
  );

  return {
    mode: offerNew ? mode : "existing",
    name,
    bm25Name: name.trim() ? bm25SiblingIndexName(name.trim(), maxLength) : "",
    creating,
    setMode,
    setName,
    selectExisting,
    clearSelection,
    ensureCreated,
  };
}
