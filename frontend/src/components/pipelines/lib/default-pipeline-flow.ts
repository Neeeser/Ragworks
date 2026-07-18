import { layoutPipelineNodes } from "@/components/pipelines/lib/pipeline-layout";
import { buildTopologyPlaybackSteps } from "@/components/pipelines/lib/pipeline-playback";
import { toFlowEdges, toFlowNodes } from "@/components/pipelines/lib/pipeline-utils";
import fixtureJson from "@/components/readme/readme-pipelines.generated.json";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { FlowStep } from "@/components/pipelines/lib/pipeline-playback";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodeSpec, PipelineDefinition, PipelineKind } from "@/lib/types";
import type { Node } from "@xyflow/react";

type DefaultPipelineFixture = {
  scenes: { kind: PipelineKind; definition: PipelineDefinition }[];
  node_specs: NodeSpec[];
};

export type DefaultPipelineFlow = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  steps: FlowStep[];
};

// The backend exporter validates this generated JSON before it reaches the
// TypeScript boundary. Landing and README rendering deliberately share this
// one fixture so the hybrid product diagram cannot drift from the defaults.
export const DEFAULT_PIPELINE_FIXTURE = fixtureJson as DefaultPipelineFixture;

export function buildDefaultPipelineFlow(kind: PipelineKind): DefaultPipelineFlow {
  const scene = DEFAULT_PIPELINE_FIXTURE.scenes.find((candidate) => candidate.kind === kind);
  if (!scene) {
    throw new Error(`Missing generated default pipeline fixture for ${kind}.`);
  }
  const edges = toFlowEdges(scene.definition, DEFAULT_PIPELINE_FIXTURE.node_specs);
  const nodes = layoutPipelineNodes(
    toFlowNodes(scene.definition, DEFAULT_PIPELINE_FIXTURE.node_specs),
    edges,
  );
  const steps = buildTopologyPlaybackSteps(scene.definition);
  return { nodes, edges, steps };
}
