import { render, screen } from "@testing-library/react";
import { Position } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import { TypedEdge } from "@/components/pipelines/flow/TypedEdge";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { EdgeProps } from "@xyflow/react";
import type { CSSProperties } from "react";

const BATCH_PATH = "M 264 74 L 680 74 L 680 222 L 736 222";
const EDGE_TEST_ID = "base-edge";
const STROKE_ATTRIBUTE = "data-stroke";
type MockRoute = {
  svgPathString: string;
  edgeCenterX: number;
  edgeCenterY: number;
  points: number[][];
};
const usePipelineEdgeRoute = vi.fn<(input: unknown) => MockRoute | null>(() => ({
  svgPathString: BATCH_PATH,
  edgeCenterX: 500,
  edgeCenterY: 148,
  points: [
    [680, 74],
    [680, 222],
  ],
}));

vi.mock("@/components/pipelines/flow/PipelineEdgeRoutingProvider", () => ({
  usePipelineEdgeRoute: (input: unknown) => usePipelineEdgeRoute(input),
}));

vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ path, style }: { path: string; style?: CSSProperties }) => (
    <path
      data-testid="base-edge"
      d={path}
      data-stroke={style?.stroke}
      data-stroke-width={style?.strokeWidth}
      data-opacity={style?.opacity}
    />
  ),
  getSmoothStepPath: () => ["fallback-path"],
  Position: { Left: "left", Right: "right" },
}));

const edgeProps = {
  id: "source-target",
  source: "source",
  target: "target",
  sourceX: 264,
  sourceY: 74,
  targetX: 736,
  targetY: 222,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  data: {
    dataType: "document",
    traveling: true,
    travelMs: 500,
  },
  selected: false,
} satisfies EdgeProps<TypedEdgeType>;

describe("TypedEdge", () => {
  it("uses the shared batch route while preserving state styles and playback", () => {
    const { container } = render(
      <svg>
        <TypedEdge {...edgeProps} />
      </svg>,
    );

    expect(usePipelineEdgeRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        id: edgeProps.id,
        source: edgeProps.source,
        target: edgeProps.target,
        sourceX: edgeProps.sourceX,
        sourceY: edgeProps.sourceY,
        targetX: edgeProps.targetX,
        targetY: edgeProps.targetY,
      }),
    );
    expect(screen.getByTestId(EDGE_TEST_ID)).toHaveAttribute("d", BATCH_PATH);
    expect(screen.getByTestId(EDGE_TEST_ID)).toHaveAttribute(
      STROKE_ATTRIBUTE,
      "var(--port-document)",
    );
    expect(container.querySelectorAll("animateMotion")).toHaveLength(2);
    container.querySelectorAll("animateMotion").forEach((motion) => {
      expect(motion).toHaveAttribute(
        "path",
        `M 258,74 L 264 74 L 680 74 L 680 222 L 736 222 L 742,222`,
      );
      expect(motion).toHaveAttribute("dur", "500ms");
    });
  });

  it("extends the payload dot's travel to rest on the port handle centers", () => {
    const { container } = render(
      <svg>
        <TypedEdge {...edgeProps} />
      </svg>,
    );

    // React Flow anchors edges at the handle's outer edge; the visible port
    // dot is centered one handle-radius inward. A dot frozen at the raw path
    // end sits visibly offset beside the gray handle dot.
    const motion = container.querySelector("animateMotion");
    const path = motion?.getAttribute("path") ?? "";
    expect(path.startsWith("M 258,74 ")).toBe(true); // source: Right → center 6px left of anchor
    expect(path.endsWith(" L 742,222")).toBe(true); // target: Left → center 6px right of anchor
  });

  it("uses the smooth-step fallback while a batch route is pending", () => {
    usePipelineEdgeRoute.mockReturnValueOnce(null);

    render(
      <svg>
        <TypedEdge {...edgeProps} data={{ ...edgeProps.data, traveling: false }} />
      </svg>,
    );

    expect(screen.getByTestId(EDGE_TEST_ID)).toHaveAttribute("d", "fallback-path");
  });

  it("preserves validation, emphasis, and visited edge states", () => {
    const { rerender } = render(
      <svg>
        <TypedEdge {...edgeProps} data={{ dataType: "document", error: true }} />
      </svg>,
    );

    expect(screen.getByTestId(EDGE_TEST_ID)).toHaveAttribute(STROKE_ATTRIBUTE, "var(--data-neg)");
    expect(screen.getByTestId(EDGE_TEST_ID)).toHaveAttribute("data-stroke-width", "2.5");
    expect(screen.getByTestId(EDGE_TEST_ID)).toHaveAttribute("data-opacity", "0.95");

    rerender(
      <svg>
        <TypedEdge {...edgeProps} data={{ dataType: "document", visited: true }} />
      </svg>,
    );
    expect(screen.getByTestId(EDGE_TEST_ID)).toHaveAttribute(
      STROKE_ATTRIBUTE,
      "var(--port-document)",
    );
    expect(screen.getByTestId(EDGE_TEST_ID)).toHaveAttribute("data-stroke-width", "1.5");
    expect(screen.getByTestId(EDGE_TEST_ID)).toHaveAttribute("data-opacity", "0.95");
  });
});
