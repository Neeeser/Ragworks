import type { RouterBranchSplitShape } from "./shape-guards";
import type { TraceValueViewProps } from "./TraceValueViews";

/**
 * How a router split its stream: one row per branch, in the order the router
 * tried them, with the test it applied and how many items it took.
 *
 * Order is the node's semantics — the first branch that holds takes the item —
 * so the rows are never sorted by count. A branch that took nothing states
 * that rather than disappearing: an empty branch is the answer to "why did
 * nothing come out of here", and a row missing from the list is not.
 */
export function RouterBranchesValue({ value }: TraceValueViewProps) {
  const { branches } = value as RouterBranchSplitShape;
  if (branches.length === 0) {
    return (
      <p className="text-ui text-muted">No branches configured — every item went to Unmatched.</p>
    );
  }
  return (
    <ul className="max-h-52 space-y-1 overflow-auto">
      {branches.map((branch, index) => (
        <li
          key={`${branch.branch}-${index}`}
          className="flex items-center justify-between gap-3 rounded-control border border-hairline bg-surface px-3 py-2"
        >
          <span className="min-w-0">
            <span className="block truncate text-ui text-primary">{branch.branch}</span>
            <span className="block truncate font-mono text-instrument text-meta">
              {branch.expression || "no expression"}
            </span>
          </span>
          <span className="shrink-0 font-mono text-num tabular-nums text-body">
            {branch.items.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
