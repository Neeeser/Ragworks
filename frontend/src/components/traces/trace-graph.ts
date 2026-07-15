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
  /** FlowStep contract — trace steps always visit exactly one node. */
  nodeIds: string[];
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
    nodeIds: [run.node_id],
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
  steps: graph.steps.map((step) => ({
    ...step,
    nodeId: `${prefix}${step.nodeId}`,
    nodeIds: step.nodeIds.map((id) => `${prefix}${id}`),
  })),
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

type IndexTarget = {
  key: string;
  indexName: string;
  backend?: string;
  indexers: Node<PipelineNodeData>[];
  retrievers: Node<PipelineNodeData>[];
};

const nodeIndexTarget = (node: Node<PipelineNodeData>) => {
  const indexName = (node.data.config.index_name as string | undefined) ?? "index";
  const backend = node.data.config.backend as string | undefined;
  return { key: `${backend ?? ""}:${indexName}`, indexName, backend };
};

/** Pair every compatible ingestion indexer and retrieval branch by index target. */
const collectIndexTargets = (
  originNodes: Node<PipelineNodeData>[],
  retrievalNodes: Node<PipelineNodeData>[],
): IndexTarget[] => {
  const targets = new Map<string, IndexTarget>();
  const add = (node: Node<PipelineNodeData>, side: "indexers" | "retrievers") => {
    const target = nodeIndexTarget(node);
    const entry = targets.get(target.key) ?? { ...target, indexers: [], retrievers: [] };
    entry[side].push(node);
    targets.set(target.key, entry);
  };
  originNodes
    .filter((node) => node.data.nodeType.startsWith("indexer."))
    .forEach((node) => add(node, "indexers"));
  retrievalNodes
    .filter((node) => node.data.nodeType.startsWith("retriever."))
    .forEach((node) => add(node, "retrievers"));
  return [...targets.values()].filter(
    (target) => target.indexers.length > 0 && target.retrievers.length > 0,
  );
};

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
    // A solo trace can be either kind — a document's ingestion run also lands
    // here. Label the steps by what actually ran.
    const isIngestion = retrieval.run.kind === "ingestion";
    const stage = buildStage(
      retrieval,
      nodeSpecs,
      isIngestion ? "origin" : "retrieval",
      isIngestion ? "Ingestion" : "Retrieval",
    );
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
  const indexTargets = collectIndexTargets(originStage.nodes, retrievalStage.nodes);
  indexTargets.forEach((target, targetIndex) => {
    const storeId =
      indexTargets.length === 1 ? INDEX_STORE_NODE_ID : `${INDEX_STORE_NODE_ID}:${targetIndex + 1}`;
    const endpoints = [...target.indexers, ...target.retrievers];
    const storeNode = {
      id: storeId,
      type: "indexStore",
      position: {
        x: endpoints.reduce((sum, node) => sum + node.position.x, 0) / endpoints.length,
        y: originBottom + BAND_GAP_Y / 2 - 40,
      },
      draggable: false,
      selectable: false,
      // Explicit dimensions: layout/edge-routing geometry estimates any
      // unmeasured node via estimateNodeHeight, which reads PipelineNodeData
      // ports this datastore node doesn't have.
      width: 220,
      height: 88,
      data: { indexName: target.indexName, backend: target.backend },
      // The store carries IndexStoreNodeData, not PipelineNodeData; ReactFlow
      // dispatches rendering by `type`, so the heterogeneous array is safe at
      // runtime (same pattern as the editor's drop-preview node).
    } as unknown as Node<PipelineNodeData>;
    nodes.push(storeNode);
    target.indexers.forEach((indexer, endpointIndex) => {
      edges.push({
        id:
          indexTargets.length === 1 && target.indexers.length === 1
            ? "index::write"
            : `index::write:${targetIndex + 1}:${endpointIndex + 1}`,
        source: indexer.id,
        sourceHandle: indexer.data.outputs[0]?.key,
        target: storeId,
        targetHandle: "write",
        type: "typed",
        data: { dataType: "indexed_batch", visited: true },
        style: { strokeDasharray: "6 5" },
      });
    });
    target.retrievers.forEach((retriever, endpointIndex) => {
      edges.push({
        id:
          indexTargets.length === 1 && target.retrievers.length === 1
            ? "index::read"
            : `index::read:${targetIndex + 1}:${endpointIndex + 1}`,
        source: storeId,
        sourceHandle: "read",
        target: retriever.id,
        targetHandle: retriever.data.inputs[0]?.key,
        type: "typed",
        data: { dataType: "indexed_batch", visited: true },
        style: { strokeDasharray: "6 5" },
      });
    });
  });

  return {
    nodes,
    edges,
    steps: [...originStage.steps, ...retrievalStage.steps],
    combined: true,
  };
};
