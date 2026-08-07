import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { useNodeEditing } from "@/components/pipelines/hooks/use-node-editing";
import { makeNodeSpec } from "@/test/fixtures";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { Node } from "@xyflow/react";

const nodeData = (overrides: Partial<PipelineNodeData> = {}): PipelineNodeData => ({
  label: "Retriever",
  nodeType: "retriever.vector",
  inputs: [],
  outputs: [],
  config: {},
  configSchema: {},
  ...overrides,
});

const makeNode = (id: string, overrides: Partial<Node<PipelineNodeData>> = {}) =>
  ({
    id,
    type: "pipelineNode",
    position: { x: 0, y: 0 },
    data: nodeData(),
    ...overrides,
  }) satisfies Node<PipelineNodeData>;

/** Drives the hook against real node/edge state, the way the builder does. */
function renderEditor(
  initialNodes: Node<PipelineNodeData>[] = [],
  initialEdges: TypedEdgeType[] = [],
) {
  return renderHook(() => {
    const [nodes, setNodes] = useState(initialNodes);
    const [edges, setEdges] = useState(initialEdges);
    return { nodes, edges, editor: useNodeEditing({ nodes, setNodes, setEdges }) };
  });
}

describe("useNodeEditing", () => {
  it("leaves the inspector closed when a node is only selected", () => {
    const { result } = renderEditor([makeNode("node-1", { selected: true })]);

    act(() => result.current.editor.selectNode());

    expect(result.current.editor.selectedNode?.id).toBe("node-1");
    expect(result.current.editor.inspectedNode).toBeNull();
  });

  it("opens the inspector on the node it is asked to open, and selects it", () => {
    const { result } = renderEditor([makeNode("node-1"), makeNode("node-2")]);

    act(() => result.current.editor.openNode("node-2"));

    expect(result.current.editor.inspectedNode?.id).toBe("node-2");
    expect(result.current.editor.selectedNode?.id).toBe("node-2");
  });

  it("closing the inspector leaves the node selected", () => {
    const { result } = renderEditor([makeNode("node-1")]);

    act(() => result.current.editor.openNode("node-1"));
    act(() => result.current.editor.closeEditor());

    expect(result.current.editor.inspectedNode).toBeNull();
    expect(result.current.editor.selectedNode?.id).toBe("node-1");
  });

  it("drops a node selected, with the inspector shut when nothing is unset", () => {
    const { result } = renderEditor();
    const spec = makeNodeSpec({
      type: "chunker.token",
      label: "Token Chunker",
      default_config: { chunk_size: 400 },
    });

    act(() => result.current.editor.addNode(spec, { x: 120, y: 80 }));

    const added = result.current.nodes[0];
    expect(added?.position).toEqual({ x: 120, y: 80 });
    expect(added?.selected).toBe(true);
    expect(result.current.editor.inspectedNode).toBeNull();
  });

  it("opens the inspector on a dropped node whose index is unset", () => {
    const { result } = renderEditor();
    const spec = makeNodeSpec({ type: "retriever.vector", label: "Retriever", default_config: {} });

    act(() => result.current.editor.addNode(spec, { x: 10, y: 10 }));

    expect(result.current.editor.inspectedNode?.id).toBe(result.current.nodes[0]?.id);
  });

  it("deleting a node removes its edges and closes the inspector on it", () => {
    const edges: TypedEdgeType[] = [
      { id: "edge-1", source: "node-1", target: "node-2" },
      { id: "edge-2", source: "node-2", target: "node-3" },
    ];
    const { result } = renderEditor(
      [makeNode("node-1"), makeNode("node-2"), makeNode("node-3")],
      edges,
    );

    act(() => result.current.editor.openNode("node-2"));
    act(() => result.current.editor.deleteNode("node-2"));

    expect(result.current.nodes.map((node) => node.id)).toEqual(["node-1", "node-3"]);
    expect(result.current.edges).toEqual([]);
    expect(result.current.editor.inspectedNode).toBeNull();
  });

  it("closes the inspector when the key-deleted node was the open one", () => {
    const { result } = renderEditor([makeNode("node-1")]);

    act(() => result.current.editor.openNode("node-1"));
    act(() => result.current.editor.handleNodesDeleted([{ id: "node-1" }]));

    expect(result.current.editor.inspectedNode).toBeNull();
  });
});
