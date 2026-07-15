import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReadmePipelineCapture } from "@/components/readme/ReadmePipelineCapture";

const flowPlayerSpy = vi.fn();

vi.mock("@/components/pipelines/flow/FlowPlayer", () => ({
  FlowPlayer: (props: object) => {
    flowPlayerSpy(props);
    return <div data-testid="flow-player" />;
  },
}));

describe("ReadmePipelineCapture", () => {
  it("starts one non-looping retrieval run only when capture requests it", async () => {
    const user = userEvent.setup();
    render(<ReadmePipelineCapture kind="retrieval" />);

    expect(screen.getByRole("heading", { name: "Default retrieval pipeline" })).toBeVisible();
    expect(screen.getByTestId("flow-player")).toBeVisible();
    expect(flowPlayerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        autoPlay: false,
        fitViewPadding: 0.05,
        loop: false,
        processMs: 550,
        travelMs: 400,
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "bm25-retriever" }),
          expect.objectContaining({ id: "fuse-results" }),
        ]),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Start pipeline capture" }));

    expect(flowPlayerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoPlay: true, loop: false }),
    );
  });

  it("lays out the fixture graph instead of stacking unpositioned nodes", () => {
    render(<ReadmePipelineCapture kind="ingestion" />);

    // The generated fixture carries no positions; without the shared
    // auto-layout every node lands at (0,0) and the capture films a single
    // stacked card instead of the pipeline.
    const { nodes } = flowPlayerSpy.mock.calls.at(-1)?.[0] as {
      nodes: { id: string; position: { x: number; y: number } }[];
    };
    const positions = new Set(nodes.map((node) => `${node.position.x}:${node.position.y}`));
    expect(positions.size).toBe(nodes.length);
  });
});
