"use client";

import { useMemo } from "react";

import { layoutPipelineNodes } from "@/components/pipelines/lib/pipeline-layout";
import { buildTopologyPlaybackSteps } from "@/components/pipelines/lib/pipeline-playback";
import {
  buildIngestionDefinition,
  type IntakeMode,
} from "@/components/pipelines/lib/pipeline-scaffold";
import { toFlowEdges, toFlowNodes } from "@/components/pipelines/lib/pipeline-utils";
import { scaffoldToolTemplate } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { FlowStep } from "@/components/pipelines/lib/pipeline-playback";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type {
  BackendInfo,
  IndexBackend,
  NodeSpec,
  PipelineDefinition,
  ToolTemplate,
} from "@/lib/types";
import type { Node } from "@xyflow/react";

export type WizardScaffoldChoices = {
  isIngestion: boolean;
  template: ToolTemplate | null;
  backend: IndexBackend;
  backendInfo: BackendInfo | null;
  indexName: string;
  indexDimension: number | null | undefined;
  embeddingModel: string;
  embeddingConnectionId: string | null;
  rerankingModel: string;
  rerankingConnectionId: string | null;
  intake: IntakeMode;
  chunkSize: number;
  chunkOverlap: number;
};

export type WizardPreview = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  steps: FlowStep[];
};

export type WizardScaffold = {
  definition: PipelineDefinition | null;
  preview: WizardPreview;
  loading: boolean;
  error: string | null;
};

const EMPTY_PREVIEW: WizardPreview = { nodes: [], edges: [], steps: [] };

/** Whether the template has everything it declares it needs. */
function scaffoldReady(choices: WizardScaffoldChoices): boolean {
  const { template } = choices;
  if (!template) return false;
  if (template.needs_store && !choices.indexName.trim()) return false;
  if (template.needs_embedding && !(choices.embeddingConnectionId && choices.embeddingModel)) {
    return false;
  }
  return (
    !template.needs_reranker || Boolean(choices.rerankingConnectionId && choices.rerankingModel)
  );
}

/**
 * The definition the wizard will create, and its laid-out preview.
 *
 * Tool graphs are built by the server (`POST /api/pipelines/tool-templates/{id}`)
 * so the wizard creates exactly what the shipped template catalog defines —
 * the same builders the first-run setup wizard scaffolds a collection with.
 * The ingestion scaffold is still assembled here: its intake presets have no
 * server-side equivalent. Either way the review step draws the definition that
 * gets submitted rather than a drawing of it.
 */
export function useWizardScaffold(
  choices: WizardScaffoldChoices,
  nodeSpecs: NodeSpec[],
  token: string,
): WizardScaffold {
  const {
    isIngestion,
    template,
    backend,
    backendInfo,
    indexName,
    indexDimension,
    embeddingModel,
    embeddingConnectionId,
    rerankingModel,
    rerankingConnectionId,
    intake,
    chunkSize,
    chunkOverlap,
  } = choices;

  const ingestionDefinition = useMemo(() => {
    if (!isIngestion) return null;
    return buildIngestionDefinition(backend, {
      indexName: indexName.trim() || undefined,
      indexDimension: indexDimension ?? undefined,
      embeddingConnectionId: embeddingConnectionId || undefined,
      embeddingModel: embeddingModel || undefined,
      // Hybrid (semantic + BM25) scaffolds mirror the backend defaults;
      // omitted when the deployment can't serve sparse indexes.
      includeBm25: backendInfo?.lexical_available ?? false,
      indexNameMaxLength: backendInfo?.capabilities.index_name_max_length,
      intake,
      chunkSize,
      chunkOverlap,
    });
  }, [
    isIngestion,
    backend,
    backendInfo,
    indexName,
    indexDimension,
    embeddingModel,
    embeddingConnectionId,
    intake,
    chunkSize,
    chunkOverlap,
  ]);

  const templateId = template?.id ?? "";
  const ready = !isIngestion && scaffoldReady(choices);
  const scaffold = useApiQuery(
    () =>
      scaffoldToolTemplate(token, templateId, {
        backend,
        index_name: indexName.trim() || null,
        embedding_connection_id: embeddingConnectionId,
        embedding_model: embeddingModel || null,
        reranking_connection_id: rerankingConnectionId,
        reranking_model: rerankingModel || null,
      }),
    [
      token,
      templateId,
      backend,
      indexName,
      embeddingConnectionId,
      embeddingModel,
      rerankingConnectionId,
      rerankingModel,
    ],
    { enabled: ready },
  );

  const definition = isIngestion ? ingestionDefinition : scaffold.data;

  const preview = useMemo(() => {
    if (!definition) return EMPTY_PREVIEW;
    // Scaffolds carry no positions; the preview is placed by the same
    // algorithm the editor and Tidy use.
    const edges = toFlowEdges(definition, nodeSpecs);
    return {
      nodes: layoutPipelineNodes(toFlowNodes(definition, nodeSpecs), edges),
      edges,
      steps: buildTopologyPlaybackSteps(definition),
    };
  }, [definition, nodeSpecs]);

  return {
    definition,
    preview,
    loading: !isIngestion && ready && scaffold.loading,
    error: isIngestion ? null : scaffold.error,
  };
}
