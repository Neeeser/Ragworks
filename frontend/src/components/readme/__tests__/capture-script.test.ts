import { describe, expect, it } from "vitest";

import {
  CAPTURE_SIZE,
  GIF_ENCODER,
  GIF_WIDTH,
  captureDurationMs,
} from "../../../../scripts/capture-readme-pipeline.mjs";

describe("captureDurationMs", () => {
  it("covers every process and travel phase plus a short hold", () => {
    expect(captureDurationMs(6)).toBe(6100);
    expect(captureDurationMs(5)).toBe(5150);
  });

  it("captures above GitHub display resolution before encoding", () => {
    expect(CAPTURE_SIZE).toEqual({ width: 1920, height: 720 });
    expect(GIF_WIDTH).toBe(1920);
    expect(GIF_ENCODER).toBe("gifski");
  });
});
