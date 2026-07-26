import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_PALETTES, PALETTES } from "@/lib/palettes";

/**
 * The design language's token contract, asserted against globals.css itself.
 *
 * These are mechanical checks, which is the point: palettes resolve to two
 * structural modes that get verified visually, and everything a machine can
 * check about the other palettes is checked here instead of by a visual sweep
 * per palette per change.
 */

const CSS = readFileSync("src/app/globals.css", "utf8");

/** The rule opener whose block defines a palette's values. The ` {` suffix
 * anchors on the rule itself rather than a comment mentioning the selector. */
function selectorFor(paletteId: string): string {
  if (paletteId === DEFAULT_PALETTES.dark) return ':root[data-theme="dark"] {';
  if (paletteId === DEFAULT_PALETTES.light) return ':root[data-theme="light"] {';
  return `:root[data-palette="${paletteId}"] {`;
}

function blockFor(selector: string): string {
  // Palettes are written as one rule per palette; grab from the selector to the
  // first closing brace at line start.
  const index = CSS.indexOf(selector);
  if (index === -1) return "";
  const rest = CSS.slice(index);
  const end = rest.indexOf("\n}");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("palette token contract", () => {
  it("declares a CSS block for every catalog palette", () => {
    // The picker renders from src/lib/palettes.ts; a catalog entry with no CSS
    // block would offer a palette that changes nothing when selected.
    for (const palette of PALETTES) {
      expect(blockFor(selectorFor(palette.id))).not.toBe("");
    }
  });

  it("keeps dark and light as the data-theme mode selectors", () => {
    // data-theme carries the resolved structural mode (what a pre-palette
    // stored preference resolves to); data-palette carries the palette.
    expect(CSS).toContain('[data-theme="dark"]');
    expect(CSS).toContain('[data-theme="light"]');
  });

  it("keeps every picker swatch identical to the palette's own values", () => {
    // The swatch is a preview of the palette; a drifted hex previews a palette
    // that selecting doesn't produce.
    for (const palette of PALETTES) {
      const block = blockFor(selectorFor(palette.id)).toLowerCase();
      expect(block).toContain(`--canvas: ${palette.swatch.canvas}`);
      expect(block).toContain(`--panel-from: ${palette.swatch.panel}`);
    }
  });

  it("defines chart series slots separately from UI accents", () => {
    // The two families exist because --accent-cyan measures L 0.797 on the dark
    // canvas — outside the categorical band — so it cannot serve as series 2.
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      expect(CSS).toMatch(new RegExp(`--series-${slot}:`));
      expect(CSS).toMatch(new RegExp(`--color-series-${slot}: var\\(--series-${slot}\\)`));
    }
  });

  it("gives both structural modes the same series slots", () => {
    // The UMAP plane cycles documents through every slot, so a mode missing one
    // paints those documents with an unresolved var() — no colour at all.
    const slotsIn = (paletteId: string) =>
      [...blockFor(selectorFor(paletteId)).matchAll(/--series-(\d+):/g)].map((match) => match[1]);

    expect(slotsIn(DEFAULT_PALETTES.dark)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(slotsIn(DEFAULT_PALETTES.light)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("never uses the UI accent cyan as a chart series", () => {
    const seriesValues = [...CSS.matchAll(/--series-\d+:\s*([^;]+);/g)].map((match) =>
      match[1].trim().toLowerCase(),
    );
    expect(seriesValues.length).toBeGreaterThan(0);
    expect(seriesValues).not.toContain("#22d3ee");
    for (const value of seriesValues) {
      expect(value).not.toContain("var(--accent-");
    }
  });

  it("pins the structural scales", () => {
    expect(CSS).toMatch(/--spacing:\s*4px/);
    expect(CSS).toMatch(/--radius-chip:\s*4px/);
    expect(CSS).toMatch(/--radius-control:\s*6px/);
    expect(CSS).toMatch(/--radius-panel:\s*10px/);
    expect(CSS).toMatch(/--text-instrument:\s*11px/);
    expect(CSS).toMatch(/--text-ui:\s*14px/);
    expect(CSS).toMatch(/--ease-standard:/);
    expect(CSS).toMatch(/--ease-decel:/);
    expect(CSS).toMatch(/--ease-accel:/);
  });

  it("gives every console animation a reduced-motion escape", () => {
    // A console animation that ignores the preference is the one accessibility
    // regression this system can introduce silently.
    const reducedBlocks = CSS.match(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g) ?? [];
    const guarded = reducedBlocks.join("\n");
    for (const cls of ["console-enter", "skeleton", "value-tick", "row-arrive"]) {
      expect(CSS).toContain(`.${cls}`);
      expect(guarded).toContain(cls);
    }
  });

  it("keeps every non-default palette a diff rather than a copy", () => {
    // A palette that redeclares the whole token set drifts from the base the
    // first time a token is added to one and not the others.
    const defaults = new Set(Object.values(DEFAULT_PALETTES));
    for (const palette of PALETTES.filter((entry) => !defaults.has(entry.id))) {
      const block = blockFor(selectorFor(palette.id));
      expect(block).not.toMatch(/--stage-parse:/);
      expect(block).not.toMatch(/--port-document:/);
    }
  });
});
