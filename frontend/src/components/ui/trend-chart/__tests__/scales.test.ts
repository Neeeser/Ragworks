import { describe, expect, it } from "vitest";

import { buildBandPath, buildStepPath, fractionalIndex } from "../scales";

const x = (index: number) => index * 10;
const y = (value: number) => 100 - value;

describe("buildStepPath", () => {
  it("holds each value until the next sample instead of sloping between them", () => {
    // A cumulative total does not drift upward overnight; it sits flat and
    // jumps. The corner at the second sample's x is what says so.
    const path = buildStepPath([5, 5, 9], x, y);

    expect(path).toBe("M0.00,95.00L10.00,95.00L10.00,95.00L20.00,95.00L20.00,91.00");
  });

  it("runs the last value out to the domain edge", () => {
    // Stopping at the final sample reads as the collection ending there.
    const path = buildStepPath([4, null, null], x, y);

    expect(path.endsWith("L20.00,96.00")).toBe(true);
  });

  it("is empty when nothing was measured", () => {
    expect(buildStepPath([null, null], x, y)).toBe("");
  });
});

describe("buildBandPath", () => {
  it("closes a shape out along the upper bound and back along the lower", () => {
    const path = buildBandPath([1, 2], [3, 4], x, y);

    expect(path).toBe("M0.00,97.00L10.00,96.00L10.00,98.00L0.00,99.00Z");
  });

  it("breaks into separate shapes rather than spanning an unmeasured gap", () => {
    // One band across the gap would claim a spread through buckets where no
    // query ran.
    const path = buildBandPath([1, null, 1], [3, null, 3], x, y);

    expect(path.match(/M/g)).toBeNull();
  });

  it("draws two shapes when measured runs sit either side of a gap", () => {
    const path = buildBandPath([1, 1, null, 1, 1], [3, 3, null, 3, 3], x, y);

    expect(path.match(/M/g)).toHaveLength(2);
  });
});

describe("fractionalIndex", () => {
  const origin = "2024-01-01T00:00:00Z";

  it("places a moment between bucket ticks", () => {
    // Half an hour into an hour-wide bucket is half a step along the axis.
    expect(fractionalIndex("2024-01-01T00:30:00Z", origin, 3600, 4)).toBe(0.5);
  });

  it("drops a moment past the domain rather than clamping it to the edge", () => {
    // Clamping would draw an event at a time it did not happen.
    expect(fractionalIndex("2024-01-05T00:00:00Z", origin, 3600, 4)).toBeNull();
    expect(fractionalIndex("2023-12-31T00:00:00Z", origin, 3600, 4)).toBeNull();
  });
});
