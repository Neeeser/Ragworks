import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..");
const EXTENSIONS = [".ts", ".tsx", ".css"];
// Every C0 control character except tab, newline, and carriage return.
// eslint-disable-next-line no-control-regex -- detecting them is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return EXTENSIONS.some((ext) => entry.endsWith(ext)) ? [path] : [];
  });
}

/**
 * A raw C0 control byte in a source file survives bundling verbatim: inside a
 * template literal the browser's parser aborts the script at the byte
 * ("literal not terminated before end of script"), taking down every route
 * whose chunk includes the module. esbuild and vitest tolerate it, so nothing
 * else in the gate notices. Control characters belong in source as escapes.
 */
describe("source hygiene", () => {
  it("has no raw control characters in any source file", () => {
    const offenders = sourceFiles(SRC_ROOT)
      .map((path) => ({ path, text: readFileSync(path, "utf8") }))
      .filter(({ text }) => CONTROL_CHARS.test(text))
      .map(({ path }) => path.slice(SRC_ROOT.length + 1));

    expect(offenders).toEqual([]);
  });
});
