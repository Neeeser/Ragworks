import {
  estimateNodeHeight,
  layoutPipelineNodes,
  needsAutoLayout,
} from "@/components/pipelines/lib/pipeline-layout";
import { toFlowEdges, toFlowNodes } from "@/components/pipelines/lib/pipeline-utils";
import { INDEX_STORE_NODE_ID } from "@/components/traces/IndexStoreNode";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type {
  NodeSpec,
  PipelineNodeIOTrace,
  PipelineNodeRunTrace,
  PipelineTraceResponse,
} from "@/lib/types";
import type { Node } from "@xyflow/react";

export type TraceIOGroup = {
  inputs: PipelineNodeIOTrace[];
  outputs: PipelineNodeIOTrace[];
};

export type TraceStage = "origin" | "retrieval";

/** One playback step: the visited node plus its resolved run and IO records. */
export type TraceStep = {
  nodeId: string;
  run: PipelineNodeRunTrace | null;
  io: TraceIOGroup;
  stage: TraceStage;
  stageLabel: string;
};

export type TraceGraph = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  steps: TraceStep[];
  /** True when the graph joins an origin ingestion run to the retrieval run. */
  combined: boolean;
};

const groupIO = (records: PipelineNodeIOTrace[]): Map<string, TraceIOGroup> => {
  const grouped = new Map<string, TraceIOGroup>();
  records.forEach((record) => {
    const entry = grouped.get(record.node_id) ?? { inputs: [], outputs: [] };
    if (record.io_type === "input") entry.inputs.push(record);
    else entry.outputs.push(record);
    grouped.set(record.node_id, entry);
  });
  return grouped;
};

type StageGraph = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  steps: TraceStep[];
};

/** Build one stage's laid-out graph and ordered steps from a single trace. */
const buildStage = (
  trace: PipelineTraceResponse,
  nodeSpecs: NodeSpec[],
  stage: TraceStage,
  stageLabel: string,
  forceLayout = false,
): StageGraph => {
  const orderedRuns = [...trace.node_runs].sort((a, b) => a.sequence_index - b.sequence_index);
  const runByNode = new Map(orderedRuns.map((run) => [run.node_id, run]));
  const ioByNode = groupIO(trace.node_io);

  let nodes: Node<PipelineNodeData>[] = toFlowNodes(trace.definition, nodeSpecs).map((node) => ({
    ...node,
    data: { ...node.data, status: runByNode.get(node.id)?.status },
  }));
  const edges = toFlowEdges(trace.definition, nodeSpecs);
  // A trace is a read-only narrative: when joining two runs into stacked
  // bands, always re-lay-out each band so it reads cleanly regardless of the
  // saved editor positions (which are for editing, not storytelling).
  if (forceLayout || needsAutoLayout(nodes)) {
    nodes = layoutPipelineNodes(nodes, edges);
  }

  const steps: TraceStep[] = orderedRuns.map((run) => ({
    nodeId: run.node_id,
    run,
    io: ioByNode.get(run.node_id) ?? { inputs: [], outputs: [] },
    stage,
    stageLabel,
  }));

  return { nodes, edges, steps };
};

const PREFIX_ORIGIN = "origin::";
const PREFIX_RETRIEVAL = "retrieval::";
// Clear vertical space between the ingestion band's tallest card and the
// retrieval band, with room for the index store to sit centered in it.
const BAND_GAP_Y = 220;

const prefixStage = (graph: StageGraph, prefix: string): StageGraph => ({
  nodes: graph.nodes.map((node) => ({ ...node, id: `${prefix}${node.id}` })),
  edges: graph.edges.map((edge) => ({
    ...edge,
    id: `${prefix}${edge.id}`,
    source: `${prefix}${edge.source}`,
    target: `${prefix}${edge.target}`,
  })),
  steps: graph.steps.map((step) => ({ ...step, nodeId: `${prefix}${step.nodeId}` })),
});

/** Lowest pixel the band occupies (top-y + estimated card height). */
const bandBottom = (nodes: Node<PipelineNodeData>[]): number =>
  nodes.reduce((max, node) => Math.max(max, node.position.y + estimateNodeHeight(node.data)), 0);

const offsetY = (graph: StageGraph, dy: number): StageGraph => ({
  ...graph,
  nodes: graph.nodes.map((node) => ({
    ...node,
    position: { x: node.position.x, y: node.position.y + dy },
  })),
});

/** The indexer node in an ingestion graph / retriever node in a retrieval graph. */
const findByPrefix = (nodes: Node<PipelineNodeData>[], typePrefix: string) =>
  nodes.find((node) => node.data.nodeType.startsWith(typePrefix));

/**
 * Build the playback graph for a trace. With `origin`, ingestion and retrieval
 * are laid out as two stacked bands joined by a dashed hand-off wire through
 * the shared index, and the steps run ingestion-first then retrieval — so a
 * chunk can be followed from the document it came from all the way to the
 * query that surfaced it. Without `origin`, it's just the retrieval graph.
 */
export const buildTraceGraph = (
  retrieval: PipelineTraceResponse,
  origin: PipelineTraceResponse | null,
  nodeSpecs: NodeSpec[],
): TraceGraph => {
  if (!origin) {
    const stage = buildStage(retrieval, nodeSpecs, "retrieval", "Retrieval");
    return { ...stage, combined: false };
  }

  const originStage = prefixStage(
    buildStage(origin, nodeSpecs, "origin", "Ingestion · origin", true),
    PREFIX_ORIGIN,
  );
  const retrievalRaw = prefixStage(
    buildStage(retrieval, nodeSpecs, "retrieval", "Retrieval", true),
    PREFIX_RETRIEVAL,
  );
  const originBottom = bandBottom(originStage.nodes);
  const retrievalStage = offsetY(retrievalRaw, originBottom + BAND_GAP_Y);

  const nodes: Node<PipelineNodeData>[] = [...originStage.nodes, ...retrievalStage.nodes];
  const edges: TypedEdgeType[] = [...originStage.edges, ...retrievalStage.edges];

  // The two pipelines stay fully isolated -- no node-to-node wire between
  // them. They meet only at the shared index, drawn as a datastore in the gap
  // that ingestion writes into and retrieval reads from.
  const indexer = findByPrefix(originStage.nodes, "indexer.");
  const retriever = findByPrefix(retrievalStage.nodes, "retriever.");
  if (indexer && retriever) {
    const indexName =
      (indexer.data.config.index_name as string | undefined) ??
      (retriever.data.config.index_name as string | undefined) ??
      "index";
    const backend =
      (indexer.data.config.backend as string | undefined) ??
      (retriever.data.config.backend as string | undefined);
    const storeNode = {
      id: INDEX_STORE_NODE_ID,
      type: "indexStore",
      position: {
        // Centered horizontally between the two nodes it links, and vertically
        // in the cleared gap between the bands.
        x: (indexer.position.x + retriever.position.x) / 2,
        y: originBottom + BAND_GAP_Y / 2 - 40,
      },
      draggable: false,
      selectable: false,
      data: { indexName, backend },
      // The store carries IndexStoreNodeData, not PipelineNodeData; ReactFlow
      // dispatches rendering by `type`, so the heterogeneous array is safe at
      // runtime (same pattern as the editor's drop-preview node).
    } as unknown as Node<PipelineNodeData>;
    nodes.push(storeNode);
    edges.push(
      {
        id: "index::write",
        source: indexer.id,
        sourceHandle: indexer.data.outputs[0]?.key,
        target: INDEX_STORE_NODE_ID,
        targetHandle: "write",
        type: "typed",
        data: { dataType: "indexed_batch", visited: true },
        style: { strokeDasharray: "6 5" },
      },
      {
        id: "index::read",
        source: INDEX_STORE_NODE_ID,
        sourceHandle: "read",
        target: retriever.id,
        targetHandle: retriever.data.inputs[0]?.key,
        type: "typed",
        data: { dataType: "indexed_batch", visited: true },
        style: { strokeDasharray: "6 5" },
      },
    );
  }

  return {
    nodes,
    edges,
    steps: [...originStage.steps, ...retrievalStage.steps],
    combined: true,
  };
};
