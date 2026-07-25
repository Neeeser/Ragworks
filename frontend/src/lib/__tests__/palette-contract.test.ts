import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The design language's token contract, asserted against globals.css itself.
 *
 * These are mechanical checks, which is the point: palettes resolve to two
 * structural modes that get verified visually, and everything a machine can
 * check about the other palettes is checked here instead of by five visual
 * sweeps per change.
 */

const CSS = readFileSync("src/app/globals.css", "utf8");

/** Every palette selector that must define a full set of series slots. */
const PALETTES = ["deep-space", "true-black", "graphite", "paper", "high-contrast"] as const;

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
  it("declares every named palette", () => {
    for (const palette of PALETTES) {
      expect(CSS).toContain(`[data-theme="${palette}"]`);
    }
  });

  it("keeps dark and light as aliases so stored preferences still resolve", () => {
    // A user who chose a theme before palettes existed has "dark" or "light" in
    // localStorage; dropping these selectors would silently fall them back to
    // the default and read as a bug on upgrade.
    expect(CSS).toContain('[data-theme="dark"]');
    expect(CSS).toContain('[data-theme="light"]');
  });

  it("defines chart series slots separately from UI accents", () => {
    // The two families exist because --accent-cyan measures L 0.797 on the dark
    // canvas — outside the categorical band — so it cannot serve as series 2.
    expect(CSS).toMatch(/--series-1:/);
    expect(CSS).toMatch(/--series-2:/);
    expect(CSS).toMatch(/--color-series-1: var\(--series-1\)/);
    expect(CSS).toMatch(/--color-series-2: var\(--series-2\)/);
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
    for (const palette of ["true-black", "graphite", "high-contrast"]) {
      const block = blockFor(`[data-theme="${palette}"]`);
      expect(block).not.toMatch(/--stage-parse:/);
      expect(block).not.toMatch(/--port-document:/);
    }
  });
});
