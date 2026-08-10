/** The event filters a breakdown row drills into. */

import type { UsageEventParams } from "@/lib/api";
import type { UsageGroupBy, UsageKind, UsageSurface, UsageUnit } from "@/lib/types";

/**
 * A drill-down target is a whole group, never one of its per-unit rows.
 *
 * The events endpoint filters by model, kind, surface, connection and user —
 * not by unit — so a per-unit selection could not be honoured, and a list of
 * every unit's events under a header naming one unit would misdescribe itself.
 * `units` carries what the group was measured in so the panel can say so.
 */
export interface UsageSelection {
  groupBy: UsageGroupBy;
  key: string;
  label: string;
  units: UsageUnit[];
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
