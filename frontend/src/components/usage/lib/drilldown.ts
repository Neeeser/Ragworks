/** The event filters a breakdown row drills into. */

import { groupRowLabel } from "./labels";

import type { UsageEventParams } from "@/lib/api";
import type { UsageGroupBy, UsageGroupRow, UsageKind, UsageSurface, UsageUnit } from "@/lib/types";

/**
 * A drill-down target is a whole group, never one of its per-unit rows.
 *
 * The events endpoint filters by model, kind, surface, connection and user —
 * not by unit — so a per-unit selection could not be honoured, and a list of
 * every unit's events under a header naming one unit would misdescribe itself.
 *
 * It holds only what identifies the group. The name and the units it was
 * measured in are read off the current rows at render: captured at click time
 * they describe the range that was open then, and a later range change or user
 * filter refetches the events while the header keeps describing the old one.
 */
export interface UsageSelection {
  groupBy: UsageGroupBy;
  key: string;
}

export interface UsageGroupDescription {
  label: string;
  units: UsageUnit[];
}

/**
 * How the open group reads against the rows currently loaded.
 *
 * A group that has left the range keeps its key as its name — the events list
 * is still the answer for it, and inventing a label it no longer carries would
 * be worse than the literal.
 */
export function describeGroup(
  groups: UsageGroupRow[],
  selection: UsageSelection,
): UsageGroupDescription {
  const rows = groups.filter((row) => row.key === selection.key);
  const first = rows[0];
  return {
    label: first ? groupRowLabel(selection.groupBy, first.key, first.label) : selection.key,
    units: [...new Set(rows.map((row) => row.unit))],
  };
}

type EventFilters = Pick<UsageEventParams, "kind" | "surface" | "connection_id" | "model"> & {
  user_id?: string;
};

/**
 * A row's filters, or `null` for a group the events endpoint cannot express.
 *
 * The unattributed group has no key by definition, so there is no filter that
 * selects exactly its rows — offering the drill-down anyway would list the
 * whole range and claim it was that group's.
 */
export function drilldownFilters(selection: UsageSelection): EventFilters | null {
  switch (selection.groupBy) {
    case "model":
      return { model: selection.key };
    case "kind":
      return { kind: selection.key as UsageKind };
    case "surface":
      return { surface: selection.key as UsageSurface };
    case "connection":
      return { connection_id: selection.key };
    case "user":
      return { user_id: selection.key };
  }
}
