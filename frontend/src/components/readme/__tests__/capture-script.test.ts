import { describe, expect, it } from "vitest";

import { LANDING_SCENES } from "@/components/landing/lib/scenes";
import {
  DEFAULT_PROCESS_MS,
  DEFAULT_TRAVEL_MS,
} from "@/components/pipelines/flow/use-flow-playback";

import {
  CAPTURE_SIZE,
  ANIMATION_FPS,
  CAPTURE_THEMES,
  FADE_SECONDS,
  ANIMATION_ENCODER,
  ANIMATION_WIDTH,
  PROCESS_MS,
  TRAVEL_MS,
  captureDurationMs,
  xfadeOffsets,
} from "../../../../scripts/capture-readme-pipeline.mjs";

describe("captureDurationMs", () => {
  it("waits out playback at the speed the capture page actually runs", () => {
    expect(PROCESS_MS).toBe(DEFAULT_PROCESS_MS);
    expect(TRAVEL_MS).toBe(DEFAULT_TRAVEL_MS);
  });

  it("covers every process and travel phase plus a short hold", () => {
    expect(captureDurationMs(6)).toBe(11250);
    expect(captureDurationMs(5)).toBe(9350);
  });

  it("encodes at capture resolution and a smooth frame rate", () => {
    expect(CAPTURE_SIZE).toEqual({ width: 1920, height: 720 });
    // Encoding below the captured width throws away detail the capture already
    // paid for, and the README asset rules floor the frame rate at 24.
    expect(ANIMATION_WIDTH).toBe(CAPTURE_SIZE.width);
    expect(ANIMATION_FPS).toBeGreaterThanOrEqual(24);
    expect(ANIMATION_ENCODER).toBe("avifenc");
  });

  it("defines matching light and dark animation assets", () => {
    expect(CAPTURE_THEMES).toEqual([
      {
        name: "dark",
        animationName: "pipeline-flow-dark.avif",
        posterName: "pipeline-flow-dark.png",
      },
      {
        name: "light",
        animationName: "pipeline-flow-light.avif",
        posterName: "pipeline-flow-light.png",
      },
    ]);
  });
});

describe("xfadeOffsets", () => {
  it("starts each clip where the previous one begins fading out", () => {
    expect(xfadeOffsets([4])).toEqual([]);
    expect(xfadeOffsets([4, 6])).toEqual([4 - FADE_SECONDS]);
  });

  // Every fade overlaps two clips, so offsets accumulate one fade of debt per
  // transition. Advancing by the raw duration instead pushes the tail scenes
  // past the end of the stitched video, and they never appear.
  it("carries the overlap forward across the whole rotation", () => {
    const offsets = xfadeOffsets([4, 4, 4, 4]);
    expect(offsets).toHaveLength(3);
    [4 - FADE_SECONDS, 8 - 2 * FADE_SECONDS, 12 - 3 * FADE_SECONDS].forEach((expected, index) =>
      expect(offsets[index]).toBeCloseTo(expected, 5),
    );
  });

  it("produces one transition per gap in the shipped rotation", () => {
    expect(xfadeOffsets(LANDING_SCENES.map(() => 5))).toHaveLength(LANDING_SCENES.length - 1);
  });
});
