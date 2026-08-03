/** Line diff between two prompt versions (LCS-based, no external deps). */

export type DiffLine =
  | { kind: "same"; text: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string };

/**
 * Diff `before` against `after` line by line. Unchanged lines interleave
 * with removals/additions in order, so the result reads top-to-bottom like
 * a unified diff body.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;
  // LCS lengths table; prompts are small, quadratic is fine.
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: "removed", text: a[i] });
      i += 1;
    } else {
      lines.push({ kind: "added", text: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    lines.push({ kind: "removed", text: a[i] });
    i += 1;
  }
  while (j < n) {
    lines.push({ kind: "added", text: b[j] });
    j += 1;
  }
  return lines;
}
