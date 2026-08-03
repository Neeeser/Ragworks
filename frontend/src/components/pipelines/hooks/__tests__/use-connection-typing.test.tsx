import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { diffDefinitions } from "../../lib/pipeline-diff";
import { toPipelineDefinition } from "../../lib/pipeline-utils";
import { useConnectionTyping } from "../use-connection-typing";

import type { TypedEdgeType } from "../../flow/TypedEdge";
import type { PipelineNodeData } from "../../PipelineNode";
import type { NodePort } from "@/lib/types";
import type { Node } from "@xyflow/react";

const TARGET = "target";
const EXISTING_EDGE = "edge-1";

const port = (key: string, dataType = "items", acceptsMany = false): NodePort => ({
  key,
  label: key,
  data_type: dataType,
  required: true,
  accepts_many: acceptsMany,
  requires: [],
  adds: [],
  preserves: false,
});

const node = (
  id: string,
  ports: { inputs?: NodePort[]; outputs?: NodePort[] },
): Node<PipelineNodeData> => ({
  id,
  type: "pipelineNode",
  position: { x: 0, y: 0 },
  data: {
    label: id,
    nodeType: "retriever.vector",
    inputs: ports.inputs ?? [],
    outputs: ports.outputs ?? [],
    config: {},
    configSchema: {},
  },
});

/** Two sources into one single-connection input, already wired from `source-a`. */
function renderTyping(targetInput: NodePort = port("in")) {
  const nodes = [
    node("source-a", { outputs: [port("out")] }),
    node("source-b", { outputs: [port("out")] }),
    node(TARGET, { inputs: [targetInput] }),
  ];
  const initialEdges: TypedEdgeType[] = [
    {
      id: EXISTING_EDGE,
      source: "source-a",
      target: TARGET,
      sourceHandle: "out",
      targetHandle: "in",
      type: "typed",
      data: {},
    },
  ];
  let edges = initialEdges;
  const onInvalidConnection = vi.fn();
  const hook = renderHook(() =>
    useConnectionTyping({
      nodes,
      edges,
      setEdges: (updater) => {
        edges = updater(edges);
      },
      onInvalidConnection,
    }),
  );
  return {
    hook,
    nodes,
    initialEdges,
    onInvalidConnection,
    edgesNow: () => edges,
  };
}

describe("useConnectionTyping", () => {
  it("replaces the edge already wired into a single-connection input", () => {
    const { hook, onInvalidConnection, edgesNow } = renderTyping();

    act(() => {
      hook.result.current.handleConnect({
        source: "source-b",
        target: TARGET,
        sourceHandle: "out",
        targetHandle: "in",
      });
    });

    // The wire lands rather than vanishing, and the one it displaced is gone.
    expect(edgesNow()).toHaveLength(1);
    expect(edgesNow()[0]).toMatchObject({ source: "source-b", target: TARGET });
    expect(edgesNow().some((edge) => edge.id === EXISTING_EDGE)).toBe(false);
    expect(onInvalidConnection).not.toHaveBeenCalled();
  });

  it("reports the replaced edge as an unsaved disconnect", () => {
    const { hook, nodes, initialEdges, edgesNow } = renderTyping();
    const before = toPipelineDefinition(nodes, initialEdges);

    act(() => {
      hook.result.current.handleConnect({
        source: "source-b",
        target: TARGET,
        sourceHandle: "out",
        targetHandle: "in",
      });
    });

    // Replacing is an edit like any other: the user must be able to see the
    // removal in the save panel and undo it.
    const changes = diffDefinitions(before, toPipelineDefinition(nodes, edgesNow()));
    expect(changes).toContainEqual({
      kind: "edge_removed",
      summary: "Disconnected source-a → target",
    });
    expect(changes).toContainEqual({
      kind: "edge_added",
      summary: "Connected source-b → target",
    });
  });

  it("still refuses a connection between incompatible port types", () => {
    const { hook, onInvalidConnection, edgesNow } = renderTyping(port("in", "document"));

    act(() => {
      hook.result.current.handleConnect({
        source: "source-b",
        target: TARGET,
        sourceHandle: "out",
        targetHandle: "in",
      });
    });

    expect(onInvalidConnection).toHaveBeenCalledWith("Cannot connect items to document.");
    expect(edgesNow()).toHaveLength(1);
    expect(edgesNow()[0].id).toBe(EXISTING_EDGE);
  });

  it("adds alongside an existing edge on a variadic input", () => {
    const { hook, edgesNow } = renderTyping(port("in", "items", true));

    act(() => {
      hook.result.current.handleConnect({
        source: "source-b",
        target: TARGET,
        sourceHandle: "out",
        targetHandle: "in",
      });
    });

    expect(edgesNow()).toHaveLength(2);
  });
});
