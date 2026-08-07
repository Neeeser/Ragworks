import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROCESS_MS,
  DEFAULT_TRAVEL_MS,
} from "@/components/pipelines/flow/use-flow-playback";

import {
  CAPTURE_SIZE,
  GIF_FPS,
  CAPTURE_THEMES,
  GIF_ENCODER,
  GIF_WIDTH,
  PROCESS_MS,
  TRAVEL_MS,
  captureDurationMs,
} from "../../../../scripts/capture-readme-pipeline.mjs";

describe("captureDurationMs", () => {
  it("waits out playback at the speed the capture page actually runs", () => {
    expect(PROCESS_MS).toBe(DEFAULT_PROCESS_MS);
    expect(TRAVEL_MS).toBe(DEFAULT_TRAVEL_MS);
  });

  it("covers every process and travel phase plus a short hold", () => {
    expect(captureDurationMs(6)).toBe(11550);
    expect(captureDurationMs(5)).toBe(9650);
  });

  it("captures above GitHub display resolution before encoding", () => {
    expect(CAPTURE_SIZE).toEqual({ width: 1920, height: 720 });
    expect(GIF_FPS).toBe(20);
    expect(GIF_WIDTH).toBe(1920);
    expect(GIF_ENCODER).toBe("gifski");
  });

  it("defines matching light and dark animation assets", () => {
    expect(CAPTURE_THEMES).toEqual([
      {
        name: "dark",
        gifName: "pipeline-flow-dark.gif",
        posterName: "pipeline-flow-dark.png",
      },
      {
        name: "light",
        gifName: "pipeline-flow-light.gif",
        posterName: "pipeline-flow-light.png",
      },
    ]);
  });
});
