import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const frontendRoot = process.cwd();
const appDir = resolve(frontendRoot, "src/app");
const canonicalMarkPath = resolve(frontendRoot, "public/ragworks-mark-dark.svg");

function readRequiredFile(path: string): Buffer {
  expect(existsSync(path), `${path} is missing`).toBe(true);
  return readFileSync(path);
}

function extractPath(svg: string, id: string): string {
  const match = svg.match(new RegExp(`<path id="${id}"[^>]* d="([^"]+)"`));
  expect(match, `SVG path #${id} is missing`).not.toBeNull();
  return match?.[1] ?? "";
}

function extractViewBox(svg: string): string {
  const match = svg.match(/viewBox="([^"]+)"/);
  expect(match, "SVG viewBox is missing").not.toBeNull();
  return match?.[1] ?? "";
}

function pngDimensions(png: Buffer): [number, number] {
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

function icoDimensions(ico: Buffer): number[] {
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);

  const imageCount = ico.readUInt16LE(4);
  return Array.from({ length: imageCount }, (_, index) => {
    const width = ico.readUInt8(6 + index * 16);
    return width === 0 ? 256 : width;
  });
}

describe("favicon assets", () => {
  it("centers the complete canonical mark in a square, theme-aware SVG", () => {
    const canonicalMark = readRequiredFile(canonicalMarkPath).toString("utf8");
    const favicon = readRequiredFile(resolve(appDir, "icon.svg")).toString("utf8");

    expect(favicon).toContain('width="1024" height="1024"');
    expect(extractViewBox(favicon)).toBe(extractViewBox(canonicalMark));
    expect(favicon).toContain("prefers-color-scheme: light");
    expect(favicon).not.toContain("<text");
    expect(extractPath(favicon, "pipeline")).toBe(extractPath(canonicalMark, "pipeline"));
    expect(extractPath(favicon, "trace")).toBe(extractPath(canonicalMark, "trace"));
  });

  it("provides the expected raster fallback sizes", () => {
    const appleIcon = readRequiredFile(resolve(appDir, "apple-icon.png"));
    const favicon = readRequiredFile(resolve(appDir, "favicon.ico"));

    expect(pngDimensions(appleIcon)).toEqual([180, 180]);
    expect(icoDimensions(favicon)).toEqual([16, 32, 48, 256]);
  });

  it("keeps committed assets synchronized with the canonical navbar marks", () => {
    expect(() =>
      execFileSync("node", ["scripts/generate-brand-icons.mjs", "--check"], {
        cwd: frontendRoot,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
