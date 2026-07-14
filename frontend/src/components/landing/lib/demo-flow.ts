import { layoutPipelineNodes } from "@/components/pipelines/lib/pipeline-layout";
import { buildTopologyPlaybackSteps } from "@/components/pipelines/lib/pipeline-playback";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { FlowStep } from "@/components/pipelines/lib/pipeline-playback";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodePort } from "@/lib/types";
import type { Node } from "@xyflow/react";

/**
 * Builder for the landing page's *synthetic* pipeline scenes — hand-authored
 * graphs built entirely in memory (no telemetry, no traces, no network) so
 * they render on the unauthenticated public page. The visualization itself is
 * the real product component (`FlowPlayer`), fed nodes/edges/steps in the
 * same shape the trace viewer produces. Scene content lives in `scenes.ts`;
 * this module only turns a `SceneDefinition` into renderable flow data.
 */

export type DemoPort = { key: string; label: string; dataType: string };

export type DemoNode = {
  id: string;
  /** Prefix (before the dot) drives the node's color family in PipelineNode. */
  nodeType: string;
  label: string;
  description: string;
  input?: DemoPort;
  output?: DemoPort;
  /**
   * Fake-but-plausible config rendered on the card's signature readout
   * (model name, index name, chunk size) so no node shows an unset
   * "no model selected" placeholder.
   */
  config?: Record<string, unknown>;
  /**
   * Manual grid placement (column / row) — an escape hatch, STRONGLY NOT
   * recommended. Scenes are placed by the shared pipeline auto-layout
   * (`layoutPipelineNodes`, the same algorithm as the editor's Tidy button),
   * so they stay correct when the algorithm, card sizes, or topologies
   * change. Only reach for `col`/`row` when a scene needs deliberately
   * choreographed placement the algorithm can't express — and if any node in
   * a scene sets `col`, every node in that scene is placed manually.
   */
  col?: number;
  /** Manual grid row (see `col`) — 0 is the main path, fractions center merges. */
  row?: number;
};

export type SceneDefinition = {
  nodes: DemoNode[];
  /** Wires as `[sourceId, targetId]`; handles/color derive from the node ports. */
  edges: [string, string][];
};

// Grid spacing for the manual `col`/`row` escape hatch only — auto-laid
// scenes get their spacing from the shared layout module.
const NODE_SPACING_X = 368;
const NODE_SPACING_Y = 250;

const toPort = (port: DemoPort): NodePort => ({
  key: port.key,
  label: port.label,
  data_type: port.dataType,
  required: true,
  accepts_many: false,
});

export type DemoFlow = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  steps: FlowStep[];
};

/** Turn a hand-authored scene definition into renderable flow data. Pure. */
export function buildSceneFlow(scene: SceneDefinition): DemoFlow {
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  const manual = scene.nodes.some((node) => node.col !== undefined);

  const placedNodes: Node<PipelineNodeData>[] = scene.nodes.map((node) => ({
    id: node.id,
    type: "pipelineNode",
    position: { x: NODE_SPACING_X * (node.col ?? 0), y: NODE_SPACING_Y * (node.row ?? 0) },
    data: {
      label: node.label,
      nodeType: node.nodeType,
      description: node.description,
      inputs: node.input ? [toPort(node.input)] : [],
      outputs: node.output ? [toPort(node.output)] : [],
      config: node.config ?? {},
    },
  }));

  const edges: TypedEdgeType[] = scene.edges.map(([sourceId, targetId]) => {
    const source = byId.get(sourceId);
    const target = byId.get(targetId);
    if (!source?.output || !target?.input) {
      throw new Error(`Scene edge ${sourceId} → ${targetId} references missing ports.`);
    }
    return {
      id: `${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      sourceHandle: source.output.key,
      targetHandle: target.input.key,
      type: "typed",
      // Wire color comes from the upstream output port, as toFlowEdges does.
      data: { dataType: source.output.dataType },
    };
  });

  const steps = buildTopologyPlaybackSteps({ nodes, edges });

  // Default path: the same auto-layout the editor's Tidy button uses, so
  // scenes track the real algorithm instead of hand-maintained grids.
  const nodes = manual ? placedNodes : layoutPipelineNodes(placedNodes, edges);

  return { nodes, edges, steps };
}
