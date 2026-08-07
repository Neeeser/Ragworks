"use client";

import { useMemo } from "react";

import { layoutPipelineNodes } from "@/components/pipelines/lib/pipeline-layout";
import { buildTopologyPlaybackSteps } from "@/components/pipelines/lib/pipeline-playback";
import {
  buildDefaultDefinition,
  type IntakeMode,
} from "@/components/pipelines/lib/pipeline-scaffold";
import { toFlowEdges, toFlowNodes } from "@/components/pipelines/lib/pipeline-utils";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { FlowStep } from "@/components/pipelines/lib/pipeline-playback";
import type { PipelineTemplate } from "@/components/pipelines/lib/pipeline-templates";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { BackendInfo, IndexBackend, NodeSpec, PipelineDefinition } from "@/lib/types";
import type { Node } from "@xyflow/react";

export type WizardScaffoldChoices = {
  isIngestion: boolean;
  template: PipelineTemplate;
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

/**
 * The definition the wizard will create, and its laid-out preview.
 *
 * Both derive from the wizard's choices, so the review step's graph is the
 * definition that gets submitted rather than a drawing of it.
 */
export function useWizardScaffold(
  choices: WizardScaffoldChoices,
  nodeSpecs: NodeSpec[],
): { definition: PipelineDefinition; preview: WizardPreview } {
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

  const definition = useMemo(() => {
    const options = {
      indexName: indexName.trim() || undefined,
      indexDimension: indexDimension ?? undefined,
      embeddingConnectionId: embeddingConnectionId || undefined,
      embeddingModel: embeddingModel || undefined,
      rerankingConnectionId: rerankingConnectionId || undefined,
      rerankingModel: rerankingModel || undefined,
      // Hybrid (semantic + BM25) scaffolds mirror the backend defaults;
      // omitted when the deployment can't serve sparse indexes.
      includeBm25: backendInfo?.lexical_available ?? false,
      indexNameMaxLength: backendInfo?.capabilities.index_name_max_length,
    };
    if (isIngestion) {
      return buildDefaultDefinition("ingestion", backend, {
        ...options,
        intake,
        chunkSize,
        chunkOverlap,
      });
    }
    return template.build(backend, options);
  }, [
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
  ]);

  const preview = useMemo(() => {
    // Scaffolds carry no positions; the preview is placed by the same
    // algorithm the editor and Tidy use.
    const edges = toFlowEdges(definition, nodeSpecs);
    return {
      nodes: layoutPipelineNodes(toFlowNodes(definition, nodeSpecs), edges),
      edges,
      steps: buildTopologyPlaybackSteps(definition),
    };
  }, [definition, nodeSpecs]);

  return { definition, preview };
}
