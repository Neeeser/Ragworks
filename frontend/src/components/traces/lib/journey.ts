import { isItemListTrace } from "@/components/traces/values/shape-guards";

import type { TraceGraph, TraceStage, TraceStep } from "@/components/traces/trace-graph";
import type { ItemListTrace, ItemRef, PipelineNodeSummaryValue } from "@/lib/types";

export type JourneyEffect =
  | "created"
  | "reordered"
  | "passed"
  | "dropped"
  | "absent"
  | "merged"
  | "introduced";

export type JourneyStep = {
  nodeId: string;
  nodeName: string;
  stage: TraceStage;
  stageLabel: string;
  role: string;
  rank: number | null;
  score: number | null;
  delta: number | null;
  effect: JourneyEffect;
  /** Node-local rank the item held coming in, when it appeared in an input list. */
  inputRank: number | null;
  /** Length of the input list the item was located in (or the first input list). */
  inputCount: number | null;
  /** Length of the output list the item was located in (or the first output list). */
  outputCount: number | null;
  /** How many distinct input item lists fed this node (fan-in width). */
  inputListCount: number;
};

/**
 * One pipeline stage's slice of a journey. `recorded` is false when the stage
 * ran but none of its nodes attached item identity lists — a trace recorded
 * before result tracing existed — which must read as "unrecorded", never as
 * the item being absent from results.
 */
export type JourneySection = {
  stage: TraceStage;
  stageLabel: string;
  steps: JourneyStep[];
  recorded: boolean;
};

export type JourneyFocus = {
  traveledNodeIds: Set<string>;
  absentNodeIds: Set<string>;
  traveledEdgeIds: Set<string>;
  absentEdgeIds: Set<string>;
  storeNodeIds: Set<string>;
};

type ListValue = {
  label: string;
  trace: ItemListTrace;
};

type LocatedItem = {
  list: ListValue;
  item: ItemRef;
  rank: number;
};

type StepItemLists = {
  inputs: ListValue[];
  outputs: ListValue[];
};

const itemLists = (values: PipelineNodeSummaryValue[]): ListValue[] =>
  values.flatMap((value) =>
    value.kind === "items" && isItemListTrace(value.value)
      ? [{ label: value.label, trace: value.value }]
      : [],
  );

const locate = (lists: ListValue[], focusedItemId: string): LocatedItem[] =>
  lists.flatMap((list) => {
    const index = list.trace.items.findIndex((item) => item.id === focusedItemId);
    if (index === -1) return [];
    return [{ list, item: list.trace.items[index], rank: index + 1 }];
  });

const bestRank = (items: LocatedItem[]): LocatedItem | null =>
  items.reduce<LocatedItem | null>(
    (best, item) => (!best || item.rank < best.rank ? item : best),
    null,
  );

const deriveEffect = (
  inputLists: ListValue[],
  inputItem: LocatedItem | null,
  outputItem: LocatedItem | null,
  role: string,
): JourneyEffect => {
  if (!outputItem) return inputItem ? "dropped" : "absent";
  if (inputLists.length === 0) return role === "chunks" ? "created" : "introduced";
  if (!inputItem) return "introduced";
  if (inputLists.length > 1) return "merged";
  return inputItem.rank === outputItem.rank ? "passed" : "reordered";
};

const stepItemLists = (step: TraceStep): StepItemLists | null => {
  const summary = step.run?.summary;
  if (!summary) return null;
  const inputs = itemLists(summary.inputs);
  const outputs = itemLists(summary.outputs);
  return inputs.length === 0 && outputs.length === 0 ? null : { inputs, outputs };
};

const traceRole = (selected: LocatedItem | null, lists: StepItemLists): string =>
  selected?.list.trace.kind ??
  lists.outputs[0]?.trace.kind ??
  lists.inputs[0]?.trace.kind ??
  "items";

const listLength = (located: LocatedItem | null, fallback: ListValue[]): number | null =>
  located?.list.trace.items.length ?? fallback[0]?.trace.items.length ?? null;

const buildJourneyStep = (
  step: TraceStep,
  focusedItemId: string,
  lists: StepItemLists,
): JourneyStep => {
  const inputItem = bestRank(locate(lists.inputs, focusedItemId));
  const outputItem = bestRank(locate(lists.outputs, focusedItemId));
  const selected = outputItem ?? inputItem;
  const role = traceRole(selected, lists);

  return {
    nodeId: step.nodeId,
    nodeName: step.run?.node_name ?? step.nodeId,
    stage: step.stage,
    stageLabel: step.stageLabel,
    role,
    rank: selected?.rank ?? null,
    score: selected?.item.score ?? null,
    delta: inputItem && outputItem ? inputItem.rank - outputItem.rank : null,
    effect: deriveEffect(lists.inputs, inputItem, outputItem, role),
    inputRank: inputItem?.rank ?? null,
    inputCount: listLength(inputItem, lists.inputs),
    outputCount: listLength(outputItem, lists.outputs),
    inputListCount: lists.inputs.length,
  };
};

/**
 * Derive one focused result's journey, grouped by pipeline stage. Effects are
 * set/rank arithmetic over complete item summary lists only: adding a new
 * item-capable node requires item summaries, never a node-type branch in this
 * module. A stage whose nodes recorded no item lists at all is returned with
 * `recorded: false` so the UI can label the trace as predating result tracing
 * instead of misreading it as the item being absent.
 */
export const buildJourneySections = (
  graph: TraceGraph,
  focusedItemId: string | null,
): JourneySection[] => {
  if (!focusedItemId) return [];

  const sections: JourneySection[] = [];
  graph.steps.forEach((step) => {
    let section = sections.at(-1);
    if (!section || section.stage !== step.stage) {
      section = { stage: step.stage, stageLabel: step.stageLabel, steps: [], recorded: false };
      sections.push(section);
    }
    const lists = stepItemLists(step);
    if (!lists) return;
    section.recorded = true;
    section.steps.push(buildJourneyStep(step, focusedItemId, lists));
  });
  return sections;
};

/** The flat journey across stages — the item-carrying steps in run order. */
export const buildJourney = (graph: TraceGraph, focusedItemId: string | null): JourneyStep[] =>
  buildJourneySections(graph, focusedItemId).flatMap((section) => section.steps);

/** Build node and edge tint sets from a derived journey. */
export const buildJourneyFocus = (graph: TraceGraph, journey: JourneyStep[]): JourneyFocus => {
  const traveledNodeIds = new Set(
    journey.filter((step) => step.effect !== "absent").map((step) => step.nodeId),
  );
  const absentNodeIds = new Set(
    journey.filter((step) => step.effect === "absent").map((step) => step.nodeId),
  );
  const storeNodeIds = new Set(
    graph.nodes.filter((node) => node.type === "indexStore").map((node) => node.id),
  );
  const traveledEdgeIds = new Set<string>();
  const absentEdgeIds = new Set<string>();

  graph.edges.forEach((edge) => {
    const joinsTraveledNodes = traveledNodeIds.has(edge.source) && traveledNodeIds.has(edge.target);
    const joinsStore =
      (storeNodeIds.has(edge.source) && traveledNodeIds.has(edge.target)) ||
      (traveledNodeIds.has(edge.source) && storeNodeIds.has(edge.target));
    if (joinsTraveledNodes || joinsStore) traveledEdgeIds.add(edge.id);
    else if (absentNodeIds.has(edge.source) || absentNodeIds.has(edge.target)) {
      absentEdgeIds.add(edge.id);
    }
  });

  return { traveledNodeIds, absentNodeIds, traveledEdgeIds, absentEdgeIds, storeNodeIds };
};
