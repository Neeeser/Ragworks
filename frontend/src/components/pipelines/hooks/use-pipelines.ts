"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  activatePipelineVersion,
  deletePipeline,
  fetchCollections,
  fetchPipelineNodes,
  fetchPipelines,
  listPipelineVersions,
  updatePipeline,
  validatePipeline,
} from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { getErrorMessage } from "@/lib/errors";

import type {
  Collection,
  NodeSpec,
  Pipeline,
  PipelineDefinition,
  PipelineKind,
  PipelineValidationIssue,
  PipelineVersion,
} from "@/lib/types";

interface UsePipelinesParams {
  token: string | null;
  kind: PipelineKind;
}

/** Structural equality for API payloads (stable key order from the backend). */
const sameContent = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface UsePipelinesResult {
  pipelines: Pipeline[];
  collections: Collection[];
  nodeSpecs: NodeSpec[];
  versions: PipelineVersion[];
  selectedPipeline: Pipeline | null;
  setSelectedPipeline: (pipeline: Pipeline | null) => void;
  loading: boolean;
  saving: boolean;
  validating: boolean;
  validationIssues: PipelineValidationIssue[];
  clearValidationIssues: () => void;
  message: string | null;
  setMessage: (message: string | null) => void;
  changeSummary: string;
  setChangeSummary: (value: string) => void;
  pipelineUsage: Set<string>;
  deleteTarget: Pipeline | null;
  handlePipelineCreated: (pipeline: Pipeline) => void;
  handleDeletePipeline: (pipeline: Pipeline) => void;
  cancelDeletePipeline: () => void;
  handleConfirmDelete: () => Promise<void>;
  handleSavePipeline: (definition: PipelineDefinition, fallbackSummary: string) => Promise<boolean>;
  /** Silently persist a layout-only definition (node drags, auto-layout). */
  persistLayout: (definition: PipelineDefinition) => Promise<void>;
  handleActivateVersion: (version: PipelineVersion) => Promise<void>;
}

/**
 * Owns the pipeline catalog (pipelines/nodeSpecs/collections), the selected pipeline's
 * version history, and the CRUD-ish flows around it: create-completion, delete
 * (with confirm gating), save-as-new-version, silent layout persistence, and version
 * activation. `message` is the single notice surfaced by the canvas.
 */
export function usePipelines({ token, kind }: UsePipelinesParams): UsePipelinesResult {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [nodeSpecs, setNodeSpecs] = useState<NodeSpec[]>([]);
  const [versions, setVersions] = useState<PipelineVersion[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationIssues, setValidationIssues] = useState<PipelineValidationIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);
  const [versionsReloadKey, setVersionsReloadKey] = useState(0);
  // Layout saves overlap freely with user edits; serialize them so an older
  // response can never clobber a newer one.
  const layoutSaveInFlight = useRef(false);
  const pendingLayout = useRef<PipelineDefinition | null>(null);

  // Background reloads (the auth provider rotates the token every 12 minutes)
  // must be invisible: keep the user's selection, keep object identities for
  // unchanged content (PipelineBuilder's canvas-seeding effect keys on
  // nodeSpecs — a fresh identity reseeds the canvas and wipes unsaved edits),
  // and don't flip `loading`, which unmounts the editor behind a spinner.
  const loadedKindRef = useRef<PipelineKind | null>(null);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;

    async function load() {
      if (loadedKindRef.current !== kind) setLoading(true);
      try {
        const [pipelinesResponse, nodesResponse, collectionsResponse] = await Promise.all([
          fetchPipelines(authToken, kind),
          fetchPipelineNodes(authToken),
          fetchCollections(authToken),
        ]);
        if (cancelled) return;
        setPipelines(pipelinesResponse);
        setNodeSpecs((previous) =>
          sameContent(previous, nodesResponse) ? previous : nodesResponse,
        );
        setCollections(collectionsResponse);
        setSelectedPipeline((previous) => {
          const match = previous
            ? pipelinesResponse.find((pipeline) => pipeline.id === previous.id)
            : undefined;
          if (previous && match && sameContent(previous, match)) return previous;
          return match ?? pipelinesResponse[0] ?? null;
        });
        loadedKindRef.current = kind;
      } catch (error) {
        if (!cancelled) {
          setMessage(getErrorMessage(error, "Unable to load pipelines."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token, kind]);

  const selectedPipelineId = selectedPipeline?.id ?? null;

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipelineId) {
      setVersions([]);
      return;
    }
    let cancelled = false;

    async function loadVersions() {
      try {
        const data = await listPipelineVersions(authToken, selectedPipelineId as string);
        if (!cancelled) setVersions(data);
      } catch (error) {
        if (!cancelled) {
          setMessage(getErrorMessage(error, "Unable to load versions."));
        }
      }
    }

    loadVersions();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, token, versionsReloadKey]);

  const pipelineUsage = useMemo(() => {
    const usage = new Set<string>();
    collections.forEach((collection) => {
      if (collection.ingestion_pipeline_id) {
        usage.add(collection.ingestion_pipeline_id);
      }
      if (collection.retrieval_pipeline_id) {
        usage.add(collection.retrieval_pipeline_id);
      }
    });
    return usage;
  }, [collections]);

  const applyUpdatedPipeline = useCallback((updated: Pipeline) => {
    setPipelines((prev) =>
      prev.map((pipeline) => (pipeline.id === updated.id ? updated : pipeline)),
    );
    setSelectedPipeline((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  const handlePipelineCreated = (created: Pipeline) => {
    setPipelines((prev) => [created, ...prev]);
    setSelectedPipeline(created);
    setChangeSummary("");
    setValidationIssues(created.validation_issues ?? []);
    const warnings = (created.validation_issues ?? []).filter(
      (issue) => issue.severity === "warning",
    );
    setMessage(
      warnings.length > 0
        ? `Pipeline created with warnings: ${warnings.map((issue) => issue.message).join(" ")}`
        : "Pipeline created.",
    );
  };

  const handleDeletePipeline = (pipeline: Pipeline) => {
    if (pipelineUsage.has(pipeline.id)) {
      setMessage("This pipeline is used by a collection and cannot be deleted.");
      return;
    }
    setDeleteTarget(pipeline);
  };

  const cancelDeletePipeline = () => setDeleteTarget(null);

  const handleConfirmDelete = async () => {
    const authToken = token ?? "";
    if (!authToken || !deleteTarget) return;
    if (pipelineUsage.has(deleteTarget.id)) {
      /* c8 ignore start -- guarded by pre-check in delete flow */
      setMessage("This pipeline is used by a collection and cannot be deleted.");
      setDeleteTarget(null);
      return;
      /* c8 ignore stop */
    }
    setSaving(true);
    setMessage(null);
    try {
      await deletePipeline(authToken, deleteTarget.id);
      const nextPipelines = pipelines.filter((item) => item.id !== deleteTarget.id);
      setPipelines(nextPipelines);
      if (selectedPipeline?.id === deleteTarget.id) {
        setSelectedPipeline(nextPipelines[0] ?? null);
      }
      setMessage("Pipeline deleted.");
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to delete pipeline."));
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  };

  const handleSavePipeline = async (definition: PipelineDefinition, fallbackSummary: string) => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipeline) return false;
    setValidating(true);
    setMessage(null);
    setValidationIssues([]);
    try {
      const validation = await validatePipeline(authToken, definition);
      if (!validation.valid) {
        setValidationIssues(validation.issues);
        setMessage(`Validation failed: ${validation.errors.join(" ")}`);
        return false;
      }
      const warningText = validation.warnings?.length
        ? `Warnings: ${validation.warnings.join(" ")}`
        : "";
      setSaving(true);
      const updated = await updatePipeline(authToken, selectedPipeline.id, {
        definition,
        change_summary: changeSummary || fallbackSummary || "Updated pipeline definition.",
      });
      applyUpdatedPipeline(updated);
      setChangeSummary("");
      setValidationIssues(updated.validation_issues ?? []);
      setVersionsReloadKey((prev) => prev + 1);
      setMessage(
        warningText
          ? `Saved as v${updated.current_version}. ${warningText}`
          : `Saved as v${updated.current_version}.`,
      );
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        typeof error.rawDetail === "object" &&
        error.rawDetail !== null &&
        "issues" in error.rawDetail &&
        Array.isArray(error.rawDetail.issues)
      ) {
        setValidationIssues(error.rawDetail.issues as PipelineValidationIssue[]);
      }
      setMessage(getErrorMessage(error, "Unable to save pipeline."));
      return false;
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  const persistLayout = useCallback(
    async (definition: PipelineDefinition) => {
      const authToken = token ?? "";
      if (!authToken || !selectedPipelineId) return;
      if (layoutSaveInFlight.current) {
        pendingLayout.current = definition;
        return;
      }
      layoutSaveInFlight.current = true;
      try {
        let next: PipelineDefinition | null = definition;
        while (next) {
          const payload = next;
          pendingLayout.current = null;
          const updated = await updatePipeline(authToken, selectedPipelineId, {
            definition: payload,
          });
          applyUpdatedPipeline(updated);
          next = pendingLayout.current;
        }
      } catch {
        // Layout persistence is best-effort background work; positions still
        // ride along with the next explicit save if this fails.
      } finally {
        layoutSaveInFlight.current = false;
      }
    },
    [token, selectedPipelineId, applyUpdatedPipeline],
  );

  const handleActivateVersion = async (version: PipelineVersion) => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipeline) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await activatePipelineVersion(
        authToken,
        selectedPipeline.id,
        version.version,
      );
      applyUpdatedPipeline(updated);
      setValidationIssues(updated.validation_issues ?? []);
      const warnings = (updated.validation_issues ?? []).filter(
        (issue) => issue.severity === "warning",
      );
      setMessage(
        warnings.length > 0
          ? `Activated version ${version.version} with warnings: ${warnings.map((issue) => issue.message).join(" ")}`
          : `Activated version ${version.version}.`,
      );
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to activate version."));
    } finally {
      setSaving(false);
    }
  };

  return {
    pipelines,
    collections,
    nodeSpecs,
    versions,
    selectedPipeline,
    setSelectedPipeline,
    loading,
    saving,
    validating,
    validationIssues,
    clearValidationIssues: () => setValidationIssues([]),
    message,
    setMessage,
    changeSummary,
    setChangeSummary,
    pipelineUsage,
    deleteTarget,
    handlePipelineCreated,
    handleDeletePipeline,
    cancelDeletePipeline,
    handleConfirmDelete,
    handleSavePipeline,
    persistLayout,
    handleActivateVersion,
  };
}
