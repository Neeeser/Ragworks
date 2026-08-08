"use client";

import { useCallback, useMemo, useState } from "react";

import { runPipelineDraft } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { isDraftRunInvalid } from "@/lib/types";

import {
  callerSuppliedVariables,
  initialArgumentValue,
  toRunArguments,
} from "../lib/draft-run-arguments";
import { toPipelineDefinition } from "../lib/pipeline-utils";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type {
  Collection,
  PipelineDraftRunInvalidDetail,
  PipelineDraftRunResponse,
  PipelineVariable,
} from "@/lib/types";
import type { Node } from "@xyflow/react";

type UseDraftRunOptions = {
  token: string | null;
  pipelineId: string | null;
  /** The graph on the canvas — assembled at click time, so the run is what
   * is on screen rather than whatever it looked like when the panel opened. */
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  variables: PipelineVariable[];
  /** Every collection the user owns, for the picker and its default. */
  collections: Collection[];
};

/** The default result count a draft run asks for — mirrors
 * `app/services/pipeline_draft_runs.py::DEFAULT_DRAFT_TOP_K`. */
export const DEFAULT_DRAFT_TOP_K = 5;

export type UseDraftRunResult = {
  query: string;
  setQuery: (value: string) => void;
  /** How many results the run asks for; feeds the `result_limit` argument. */
  topK: number;
  setTopK: (value: number) => void;
  /** The draft's caller-supplied variables, and the values this run sends. */
  inputVariables: PipelineVariable[];
  argumentValues: Record<string, string>;
  setArgument: (name: string, value: string) => void;
  /** The collection the run reads, defaulted from this pipeline's bindings. */
  collectionId: string | null;
  setCollectionId: (value: string) => void;
  collections: Collection[];
  running: boolean;
  result: PipelineDraftRunResponse | null;
  /** A refused draft, with the issues the editor already renders elsewhere. */
  invalid: PipelineDraftRunInvalidDetail | null;
  error: string | null;
  run: () => Promise<void>;
};

/**
 * Owns the Run panel's state: the sample query, the collection to read, and
 * the last run's trace.
 *
 * The query is session state, not part of any saved version — it is the input
 * you are tuning against, and two people editing one pipeline test it with
 * different questions. Nothing here reaches a pipeline version.
 */
export function useDraftRun({
  token,
  pipelineId,
  nodes,
  edges,
  variables,
  collections,
}: UseDraftRunOptions): UseDraftRunResult {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(DEFAULT_DRAFT_TOP_K);
  const [argumentValues, setArgumentValues] = useState<Record<string, string>>({});
  const [chosenCollectionId, setChosenCollectionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PipelineDraftRunResponse | null>(null);
  const [invalid, setInvalid] = useState<PipelineDraftRunInvalidDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived at render rather than seeded into state: a collection list that
  // arrives (or changes) after mount would otherwise leave the picker holding
  // an id nothing can name, and a background refetch would re-seed over a
  // choice the user made.
  const defaultCollectionId = useMemo(() => {
    if (!pipelineId) return null;
    const bound = collections.find((collection) =>
      collection.tools.some((tool) => tool.pipeline_id === pipelineId),
    );
    return bound?.id ?? collections[0]?.id ?? null;
  }, [collections, pipelineId]);
  const collectionId = chosenCollectionId ?? defaultCollectionId;

  // Derived at render for the same reason the collection is: the graph is
  // edited while the panel is open, so a variable added on the canvas has to
  // appear here without the panel being reopened.
  const inputVariables = useMemo(() => callerSuppliedVariables(variables), [variables]);
  const setArgument = useCallback((name: string, value: string) => {
    setArgumentValues((current) => ({ ...current, [name]: value }));
  }, []);
  // A variable's declared default is what the run sends until the user types
  // over it, so an unedited required variable still runs.
  const effectiveArguments = useMemo(() => {
    const seeded: Record<string, string> = {};
    for (const variable of inputVariables) {
      seeded[variable.name] = argumentValues[variable.name] ?? initialArgumentValue(variable);
    }
    return seeded;
  }, [inputVariables, argumentValues]);

  const run = useCallback(async () => {
    if (!token || !pipelineId || !collectionId || !query.trim()) return;
    // Both feedback channels clear at the top of every attempt, so a stale
    // refusal can never sit beside a fresh trace.
    setError(null);
    setInvalid(null);
    setRunning(true);
    try {
      setResult(
        await runPipelineDraft(token, pipelineId, {
          definition: toPipelineDefinition(nodes, edges, variables),
          collection_id: collectionId,
          query,
          top_k: topK,
          arguments: toRunArguments(inputVariables, effectiveArguments),
        }),
      );
    } catch (caught) {
      setResult(null);
      // The formatted `detail` string keeps the sentence but drops the issue
      // list the editor points at fields with, so read the raw shape.
      const detail =
        typeof caught === "object" && caught !== null && "rawDetail" in caught
          ? (caught as { rawDetail?: unknown }).rawDetail
          : null;
      if (isDraftRunInvalid(detail)) setInvalid(detail);
      else setError(getErrorMessage(caught, "Unable to run this draft."));
    } finally {
      setRunning(false);
    }
  }, [
    token,
    pipelineId,
    collectionId,
    query,
    topK,
    inputVariables,
    effectiveArguments,
    nodes,
    edges,
    variables,
  ]);

  return {
    query,
    setQuery,
    topK,
    setTopK,
    inputVariables,
    argumentValues: effectiveArguments,
    setArgument,
    collectionId,
    setCollectionId: setChosenCollectionId,
    collections,
    running,
    result,
    invalid,
    error,
    run,
  };
}
