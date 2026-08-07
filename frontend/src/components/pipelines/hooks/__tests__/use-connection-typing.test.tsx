import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { diffDefinitions } from "../../lib/pipeline-diff";
import { toPipelineDefinition } from "../../lib/pipeline-utils";
import { useConnectionTyping } from "../use-connection-typing";

import type { TypedEdgeType } from "../../flow/TypedEdge";
import type { PipelineNodeData } from "../../PipelineNode";
import type { NodePort } from "@/lib/types";
import type { FinalConnectionState, Node } from "@xyflow/react";

const TARGET = "target";
const EXISTING_EDGE = "edge-1";

const port = (key: string, overrides: Partial<NodePort> = {}): NodePort => ({
  key,
  label: key,
  data_type: "items",
  required: true,
  accepts_many: false,
  requires: [],
  adds: [],
  accepts: [],
  unaccepted: "passthrough" as const,
  preserves: false,
  removes: [],
  ...overrides,
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

/** A drop of `fromHandle` onto `toHandle`, as xyflow reports it at drag end. */
const dropState = (
  from: { nodeId: string; id: string },
  to: { nodeId: string; id: string } | null,
): FinalConnectionState =>
  ({
    fromHandle: { ...from, type: "source" },
    toHandle: to ? { ...to, type: "target" } : null,
    fromNode: null,
    toNode: null,
    fromPosition: null,
    toPosition: null,
    isValid: null,
  }) as unknown as FinalConnectionState;

const pointer = { clientX: 400, clientY: 300 } as MouseEvent;

/** Two sources into one single-connection input, already wired from `source-a`. */
function renderTyping(
  targetInput: NodePort = port("in"),
  sourceOutput: NodePort = port("out"),
  extraNodes: Node<PipelineNodeData>[] = [],
) {
  const nodes = [
    node("source-a", { outputs: [sourceOutput] }),
    node("source-b", { outputs: [sourceOutput] }),
    node(TARGET, { inputs: [targetInput], outputs: [port("out")] }),
    ...extraNodes,
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
  const onFeedback = vi.fn();
  const hook = renderHook(() =>
    useConnectionTyping({
      nodes,
      edges,
      setEdges: (updater) => {
        edges = updater(edges);
      },
      onFeedback,
    }),
  );
  return { hook, nodes, initialEdges, onFeedback, edgesNow: () => edges };
}

describe("replacing a wire on a single-connection input", () => {
  it("replaces the edge already wired there", () => {
    const { hook, edgesNow } = renderTyping();

    act(() => {
      hook.result.current.handleConnect({
        source: "source-b",
        target: TARGET,
        sourceHandle: "out",
        targetHandle: "in",
      });
    });

    expect(edgesNow()).toHaveLength(1);
    expect(edgesNow()[0]).toMatchObject({ source: "source-b", target: TARGET });
    expect(edgesNow().some((edge) => edge.id === EXISTING_EDGE)).toBe(false);
  });

  it("says which wire it removed, instead of leaving it to the save diff", () => {
    const { hook, onFeedback } = renderTyping();

    act(() => {
      hook.result.current.handleConnect({
        source: "source-b",
        target: TARGET,
        sourceHandle: "out",
        targetHandle: "in",
      });
    });

    expect(onFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "warning",
        message: "This input takes one connection, so the wire from source-a was removed.",
      }),
      null,
    );
  });

  it("warns on the handle before the drop, while the wire is being drawn", () => {
    const { hook } = renderTyping();

    act(() => {
      hook.result.current.handleConnectStart(null, {
        nodeId: "source-b",
        handleId: "out",
        handleType: "source",
      });
    });

    const connecting = hook.result.current.connecting;
    expect(connecting?.valid.has(`${TARGET}.in`)).toBe(true);
    expect(connecting?.replaces.has(`${TARGET}.in`)).toBe(true);
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

  it("adds alongside an existing edge on a variadic input", () => {
    const { hook, edgesNow } = renderTyping(port("in", { accepts_many: true }));

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

describe("refusing a connection", () => {
  it("names both streams and the fix at the point the wire was dropped", () => {
    // Text items dropped on an input that requires an embedding.
    const { hook, onFeedback } = renderTyping(
      port("in", { requires: ["embedding"], accepts: ["embedding"] }),
      port("out", { adds: ["text"] }),
    );

    act(() => {
      hook.result.current.handleConnectEnd(
        pointer,
        dropState({ nodeId: "source-b", id: "out" }, { nodeId: TARGET, id: "in" }),
      );
    });

    expect(onFeedback).toHaveBeenCalledWith(
      {
        tone: "error",
        message: "Text items → Embedded items: every item needs embedding.",
        fix: "Add an Embedder between them.",
      },
      { x: 400, y: 300 },
    );
  });

  it("reports it from the drag end, which is the only place xyflow reaches", () => {
    // `isValidConnection` refuses first, so `onConnect` never fires for a
    // refused wire — a refusal reported there is one nobody ever sees.
    const { hook, onFeedback } = renderTyping(
      port("in", { requires: ["embedding"] }),
      port("out", { adds: ["text"] }),
    );

    act(() => {
      hook.result.current.handleConnect({
        source: "source-b",
        target: TARGET,
        sourceHandle: "out",
        targetHandle: "in",
      });
    });
    const viaConnect = onFeedback.mock.calls.length;

    act(() => {
      hook.result.current.handleConnectEnd(
        pointer,
        dropState({ nodeId: "source-b", id: "out" }, { nodeId: TARGET, id: "in" }),
      );
    });

    expect(onFeedback.mock.calls.length).toBeGreaterThan(viaConnect);
  });

  it("says nothing when the wire was dropped on empty canvas", () => {
    const { hook, onFeedback } = renderTyping();

    act(() => {
      hook.result.current.handleConnectEnd(
        pointer,
        dropState({ nodeId: "source-b", id: "out" }, null),
      );
    });

    expect(onFeedback).not.toHaveBeenCalled();
  });

  it("says nothing when the drop was valid", () => {
    const { hook, onFeedback } = renderTyping(port("in", { accepts_many: true }));

    act(() => {
      hook.result.current.handleConnectEnd(
        pointer,
        dropState({ nodeId: "source-b", id: "out" }, { nodeId: TARGET, id: "in" }),
      );
    });

    expect(onFeedback).not.toHaveBeenCalled();
  });

  it("dims a target it cannot accept, and lights the one it can", () => {
    const { hook } = renderTyping(
      port("in", { requires: ["embedding"] }),
      port("out", { adds: ["text"] }),
    );

    act(() => {
      hook.result.current.handleConnectStart(null, {
        nodeId: "source-b",
        handleId: "out",
        handleType: "source",
      });
    });

    // The hint is computed by the same validator the drop is gated by, so a
    // handle can never light up and then refuse.
    expect(hook.result.current.connecting?.valid.has(`${TARGET}.in`)).toBe(false);
  });
});

describe("closing a loop", () => {
  it("names the loop the moment the wire lands, not at save", () => {
    // target → downstream → target, closed by wiring downstream back in.
    const downstream = node("downstream", {
      inputs: [port("in", { accepts_many: true })],
      outputs: [port("out")],
    });
    const { hook, onFeedback } = renderTyping(port("in", { accepts_many: true }), port("out"), [
      downstream,
    ]);

    act(() => {
      hook.result.current.handleConnect({
        source: TARGET,
        target: "downstream",
        sourceHandle: "out",
        targetHandle: "in",
      });
    });
    // The hook closed over the pre-drop edge list; re-render so the second
    // connect sees the wire the first one added.
    hook.rerender();
    act(() => {
      hook.result.current.handleConnect({
        source: "downstream",
        target: TARGET,
        sourceHandle: "out",
        targetHandle: "in",
      });
    });

    const loopCall = onFeedback.mock.calls.find(([feedback]) =>
      String(feedback.message).startsWith("This creates a loop"),
    );
    expect(loopCall?.[0].message).toBe("This creates a loop: target → downstream → target.");
    expect(loopCall?.[0].tone).toBe("error");
  });
});
