import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { resolveNodeDimensions } from "../../lib/pipeline-layout";
import { useCanvasDecorations } from "../use-canvas-decorations";

import type { PipelineNodeData } from "../../PipelineNode";
import type { Node } from "@xyflow/react";

vi.mock("../../lib/pipeline-io", () => ({
  validatePipelineEdges: () => ({ edgeErrors: {}, nodeErrors: {} }),
  validatePipelineConfig: () => ({ nodeErrors: {} }),
}));

describe("useCanvasDecorations", () => {
  it("gives the drag preview explicit geometry for edge routing", () => {
    const { result } = renderHook(() =>
      useCanvasDecorations({
        nodes: [],
        edges: [],
        connecting: null,
        validationIssues: [],
        dropPreviewPosition: { x: 100, y: 200 },
        dropPreviewLabel: "Result Limit",
      }),
    );

    expect(result.current.nodesForCanvas).toContainEqual(
      expect.objectContaining({
        id: "drop-preview",
        type: "dropPreview",
        width: 264,
        height: 80,
      }),
    );
    const preview = result.current.nodesForCanvas[0] as Node<PipelineNodeData>;
    expect(() => resolveNodeDimensions(preview)).not.toThrow();
    expect(resolveNodeDimensions(preview)).toEqual({ width: 264, height: 80 });
  });
});
