"use client";

import { InstrumentLabel } from "@/components/ui/instrument-label";

import { NodeValidationMessages } from "./NodeValidationMessages";

import type { SaveBlockerGroup } from "./lib/save-blockers";

/**
 * Findings that block a definition, grouped under the node each one names.
 *
 * Shown wherever a graph is refused — the save gate and the create wizard —
 * so a rejection reads as a list of nodes to open rather than one run-on
 * sentence beside a graph that names those nodes.
 */
export function ValidationBlockerList({
  groups,
  caption,
}: {
  groups: SaveBlockerGroup[];
  /** What the findings are blocking, stated once above the list. */
  caption: string;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="max-h-64 space-y-3 overflow-y-auto">
      <p className="text-ui text-data-neg">{caption}</p>
      {groups.map((group) => (
        <div key={group.nodeId ?? "pipeline"} className="space-y-1">
          <InstrumentLabel>{group.label}</InstrumentLabel>
          <NodeValidationMessages errors={group.errors} issues={group.issues} includeFieldIssues />
        </div>
      ))}
    </div>
  );
}
