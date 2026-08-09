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
    render(<ReadmePipelineCapture sceneId="hybrid-search" />);

    // The heading is the scene's own label from the shared rotation, so the
    // capture can never film a graph under another scene's title.
    expect(screen.getByRole("heading", { name: "Hybrid search" })).toBeVisible();
    expect(screen.getByTestId("flow-player")).toBeVisible();
    expect(flowPlayerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        autoPlay: false,
        fitViewPadding: 0.05,
        loop: false,
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "bm25-retriever" }),
          expect.objectContaining({ id: "fuse-results" }),
        ]),
      }),
    );

    // No pacing overrides: the README animation runs at the speed the app's own
    // canvas does, so the GIF is not a sped-up caricature of the real thing.
    const props = flowPlayerSpy.mock.calls.at(-1)?.[0] as object;
    expect(props).not.toHaveProperty("processMs");
    expect(props).not.toHaveProperty("travelMs");

    await user.click(screen.getByRole("button", { name: "Start pipeline capture" }));

    expect(flowPlayerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoPlay: true, loop: false }),
    );
  });

  it("refuses a scene the landing rotation does not carry", () => {
    // A capture URL naming a scene the registry dropped must fail loudly
    // rather than record an empty frame the README then ships.
    expect(() => render(<ReadmePipelineCapture sceneId="not-a-scene" />)).toThrow(/not-a-scene/);
  });

  it("lays out the fixture graph instead of stacking unpositioned nodes", () => {
    render(<ReadmePipelineCapture sceneId="hybrid-ingestion" />);

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
