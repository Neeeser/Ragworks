"use client";

import { useEffect, useMemo, useState } from "react";

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
import { getErrorMessage } from "@/lib/errors";

import { toPipelineDefinition } from "../pipeline-utils";

import type { PipelineNodeData } from "../PipelineNode";
import type { Collection, NodeSpec, Pipeline, PipelineKind, PipelineVersion } from "@/lib/types";
import type { Edge, Node } from "@xyflow/react";

interface UsePipelinesParams {
  token: string | null;
  kind: PipelineKind;
}

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
  handleSavePipeline: (
    nodes: Node<PipelineNodeData>[],
    edges: Edge[],
    nodeErrors: Record<string, string[]>,
  ) => Promise<void>;
  handleActivateVersion: (version: PipelineVersion) => Promise<void>;
}

/**
 * Owns the pipeline catalog (pipelines/nodeSpecs/collections), the selected pipeline's
 * version history, and the CRUD-ish flows around it: create-completion, delete
 * (with confirm gating), save-as-new-version, and version activation. `message` is the
 * single notice surfaced by the canvas, shared across all of these flows the same way
 * the original inline implementation did.
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
  const [message, setMessage] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [pipelinesResponse, nodesResponse, collectionsResponse] = await Promise.all([
          fetchPipelines(authToken, kind),
          fetchPipelineNodes(authToken),
          fetchCollections(authToken),
        ]);
        if (cancelled) return;
        setPipelines(pipelinesResponse);
        setNodeSpecs(nodesResponse);
        setCollections(collectionsResponse);
        setSelectedPipeline(pipelinesResponse[0] ?? null);
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

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipeline) {
      setVersions([]);
      return;
    }
    const pipelineId = selectedPipeline.id;
    let cancelled = false;

    async function loadVersions() {
      try {
        const data = await listPipelineVersions(authToken, pipelineId);
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
  }, [selectedPipeline, token]);

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

  const handlePipelineCreated = (created: Pipeline) => {
    setPipelines((prev) => [created, ...prev]);
    setSelectedPipeline(created);
    setChangeSummary("");
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

  const handleSavePipeline = async (
    nodes: Node<PipelineNodeData>[],
    edges: Edge[],
    nodeErrors: Record<string, string[]>,
  ) => {
    const authToken = token ?? "";
    if (!authToken || !selectedPipeline) return;
    const validationErrors = Object.values(nodeErrors).flat();
    if (validationErrors.length > 0) {
      setMessage(validationErrors[0]);
      return;
    }
    setValidating(true);
    setMessage(null);
    try {
      const definition = toPipelineDefinition(nodes, edges);
      const validation = await validatePipeline(authToken, definition);
      if (!validation.valid) {
        setMessage(`Validation failed: ${validation.errors.join(" ")}`);
        return;
      }
      const warningText = validation.warnings?.length
        ? `Warnings: ${validation.warnings.join(" ")}`
        : "";
      setSaving(true);
      const updated = await updatePipeline(authToken, selectedPipeline.id, {
        definition,
        change_summary: changeSummary || "Updated pipeline definition.",
      });
      setPipelines((prev) =>
        prev.map((pipeline) => (pipeline.id === updated.id ? updated : pipeline)),
      );
      setSelectedPipeline(updated);
      setChangeSummary("");
      setMessage(
        warningText
          ? `Pipeline saved as a new version. ${warningText}`
          : "Pipeline saved as a new version.",
      );
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to save pipeline."));
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

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
      setPipelines((prev) =>
        prev.map((pipeline) => (pipeline.id === updated.id ? updated : pipeline)),
      );
      setSelectedPipeline(updated);
      setMessage(`Activated version ${version.version}.`);
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
    handleActivateVersion,
  };
}
