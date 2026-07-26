import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

/**
 * `cn` must know this repo's custom `@theme` scales (src/app/globals.css).
 *
 * Undeclared, tailwind-merge reads a custom font-size token as a text COLOUR,
 * so a size and a colour land in one conflict group and the later class
 * deletes the earlier one. Every label in the console then renders at the
 * inherited size instead of its token size.
 */
const INSTRUMENT = "text-instrument";
const UI = "text-ui";
const NUM = "text-num";
const HEAD = "text-head";
const MUTED = "text-muted";
const META = "text-meta";
const PRIMARY = "text-primary";
const DATA_NEG = "text-data-neg";

const PANEL = "rounded-panel";
const FULL = "rounded-full";
const ELEVATION_1 = "shadow-elevation-1";
const EASE_STANDARD = "ease-standard";
const EASE_LINEAR = "ease-linear";

describe("cn — custom theme scales", () => {
  const SIZES = [INSTRUMENT, UI, NUM, HEAD];
  const COLOURS = [
    PRIMARY,
    "text-body",
    MUTED,
    META,
    "text-faint",
    "text-accent-violet",
    "text-accent-cyan",
    "text-data-pos",
    DATA_NEG,
    "text-data-warn",
  ];

  it("keeps a font-size token and a text-colour token together, in either order", () => {
    for (const size of SIZES) {
      for (const colour of COLOURS) {
        expect(cn(size, colour).split(" ").sort()).toEqual([colour, size].sort());
        expect(cn(colour, size).split(" ").sort()).toEqual([colour, size].sort());
      }
    }
  });

  it("still lets a later font-size token override an earlier one", () => {
    expect(cn(INSTRUMENT, UI)).toBe(UI);
    expect(cn(UI, INSTRUMENT)).toBe(INSTRUMENT);
    expect(cn(HEAD, NUM)).toBe(NUM);
    // custom and stock sizes are one scale and must still override each other
    expect(cn(INSTRUMENT, "text-xs")).toBe("text-xs");
    expect(cn("text-sm", UI)).toBe(UI);
  });

  it("still lets a later text-colour token override an earlier one", () => {
    expect(cn(MUTED, META)).toBe(META);
    expect(cn(PRIMARY, DATA_NEG)).toBe(DATA_NEG);
    expect(cn(META, "text-accent-cyan/70")).toBe("text-accent-cyan/70");
  });

  it("keeps both tokens in the real class strings the console renders", () => {
    // Field label — frontend/src/components/ui/field.tsx
    expect(cn("block text-instrument font-medium text-muted", undefined)).toBe(
      "block text-instrument font-medium text-muted",
    );
    // Field hint/error line — same file
    expect(cn("text-instrument text-meta", DATA_NEG)).toBe("text-instrument text-data-neg");
    // FileEntryRow type column — frontend/src/components/files/FileEntryRow.tsx
    expect(cn("min-w-0", "truncate text-ui text-muted")).toBe(
      "min-w-0 truncate text-ui text-muted",
    );
  });

  it("resolves the custom radius scale against itself and against Tailwind's", () => {
    expect(cn(PANEL, "rounded-chip")).toBe("rounded-chip");
    expect(cn("rounded-control", FULL)).toBe(FULL);
    expect(cn(FULL, PANEL)).toBe(PANEL);
  });

  it("treats a custom elevation as a box shadow, not a shadow colour", () => {
    expect(cn(ELEVATION_1, "shadow-elevation-2")).toBe("shadow-elevation-2");
    // a box-shadow utility and a shadow-colour utility set different properties
    expect(cn(ELEVATION_1, "shadow-accent-violet").split(" ").sort()).toEqual([
      "shadow-accent-violet",
      ELEVATION_1,
    ]);
  });

  it("resolves the custom easing scale against itself and against Tailwind's", () => {
    expect(cn(EASE_STANDARD, "ease-decel")).toBe("ease-decel");
    expect(cn(EASE_STANDARD, EASE_LINEAR)).toBe(EASE_LINEAR);
    expect(cn(EASE_LINEAR, "ease-accel")).toBe("ease-accel");
  });

  it("resolves durations through the stock numeric scale", () => {
    // durations are bare Tailwind numerics, so they need no custom declaration
    expect(cn("duration-80", "duration-200")).toBe("duration-200");
  });
});
