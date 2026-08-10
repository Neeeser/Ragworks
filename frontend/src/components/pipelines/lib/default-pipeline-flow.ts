import { intakeRequiresImages } from "@/components/pipelines/lib/intake-capability";
import { layoutPipelineNodes } from "@/components/pipelines/lib/pipeline-layout";
import { buildTopologyPlaybackSteps } from "@/components/pipelines/lib/pipeline-playback";
import {
  buildIngestionDefinition,
  DESCRIBE_PRESET_ID,
  VISION_NODE_TYPE,
} from "@/components/pipelines/lib/pipeline-scaffold";
import { toFlowEdges, toFlowNodes } from "@/components/pipelines/lib/pipeline-utils";
import { presetConfig } from "@/components/pipelines/lib/presets";
import fixtureJson from "@/components/readme/readme-pipelines.generated.json";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { FlowStep } from "@/components/pipelines/lib/pipeline-playback";
import type { IntakeMode } from "@/components/pipelines/lib/pipeline-scaffold";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodeSpec, PipelineDefinition, PipelineKind } from "@/lib/types";
import type { Node } from "@xyflow/react";

type GeneratedScene = {
  id: string;
  kind: PipelineKind;
  label: string;
  definition: PipelineDefinition;
};

type DefaultPipelineFixture = {
  scenes: GeneratedScene[];
  node_specs: NodeSpec[];
};

export type DefaultPipelineFlow = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  steps: FlowStep[];
};

// The backend exporter validates this generated JSON before it reaches the
// TypeScript boundary. Landing and README rendering deliberately share this
// one fixture so neither illustration can drift from the shipped presets.
export const DEFAULT_PIPELINE_FIXTURE = fixtureJson as DefaultPipelineFixture;

/** The store the illustrated intake variants write into, matching the exporter's. */
const SAMPLE_INDEX = { indexName: "ragworks", includeBm25: true } as const;

/**
 * The models each illustrated intake names. An intake that hands the embedder
 * images names an image-capable embedding model, because a text-only one
 * rejects every image item and the pipeline indexes nothing — an illustration
 * pairing them states a graph that cannot run.
 */
const SAMPLE_TEXT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
const SAMPLE_MULTIMODAL_EMBEDDING_MODEL = "cohere/embed-v4.0";
const SAMPLE_VISION_MODEL = "openai/gpt-4o-mini";

/** Turn a definition into renderable flow data using the exported node specs. */
function toFlow(definition: PipelineDefinition): DefaultPipelineFlow {
  const edges = toFlowEdges(definition, DEFAULT_PIPELINE_FIXTURE.node_specs);
  const nodes = layoutPipelineNodes(
    toFlowNodes(definition, DEFAULT_PIPELINE_FIXTURE.node_specs),
    edges,
  );
  return { nodes, edges, steps: buildTopologyPlaybackSteps(definition) };
}

export function buildDefaultPipelineFlow(sceneId: string): DefaultPipelineFlow {
  const scene = DEFAULT_PIPELINE_FIXTURE.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    throw new Error(`Missing generated pipeline fixture for scene "${sceneId}".`);
  }
  return toFlow(scene.definition);
}

/**
 * Build one of the wizard's intake-variant ingestion graphs.
 *
 * These have no server-side builder — `pipeline-scaffold.ts` is where the
 * create-pipeline wizard produces them — so the illustration calls that
 * scaffold directly rather than a copy, and the exporter ships the node specs
 * the resulting graph references.
 */
export function buildIntakePipelineFlow(intake: IntakeMode): DefaultPipelineFlow {
  const describes = intake === "text_described_images";
  return toFlow(
    buildIngestionDefinition("pgvector", {
      intake,
      indexName: SAMPLE_INDEX.indexName,
      includeBm25: SAMPLE_INDEX.includeBm25,
      embeddingModel: intakeRequiresImages(intake)
        ? SAMPLE_MULTIMODAL_EMBEDDING_MODEL
        : SAMPLE_TEXT_EMBEDDING_MODEL,
      visionModel: describes ? SAMPLE_VISION_MODEL : undefined,
      visionPreset: describes
        ? presetConfig(DEFAULT_PIPELINE_FIXTURE.node_specs, VISION_NODE_TYPE, DESCRIBE_PRESET_ID)
        : undefined,
    }),
  );
}
