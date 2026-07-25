// Column geometry for the file list, shared by its header, its rows, and its
// loading skeleton.
//
// One definition per column, because a header and a row that disagree about a
// width — or about the breakpoint at which a column exists at all — is a table
// that looks aligned in the viewport it was written in and nowhere else. Narrow
// viewports drop the least load-bearing columns first.

export const COL = {
  status: "w-28",
  type: "hidden w-32 min-w-0 lg:block",
  size: "w-16 text-right",
  chunks: "hidden w-14 text-right md:block",
  tokens: "hidden w-16 text-right xl:block",
  updated: "hidden w-16 text-right md:block",
};

/** In header order, for `DataRowSkeleton`. */
export const COLUMN_WIDTHS = [COL.status, COL.type, COL.size, COL.chunks, COL.tokens, COL.updated];

/** Numbers are mono and tabular so a column of them stays readable. */
export const NUMERIC_CELL = "font-mono text-ui tabular-nums text-body";
