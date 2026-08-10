/** The event filters a breakdown row drills into. */

import type { UsageEventParams } from "@/lib/api";
import type { UsageGroupBy, UsageKind, UsageSurface } from "@/lib/types";

export interface UsageSelection {
  groupBy: UsageGroupBy;
  key: string;
  label: string;
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
