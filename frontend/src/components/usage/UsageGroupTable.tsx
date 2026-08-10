"use client";

import { DataRow, DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { UNIT_LABELS, formatCostCell, groupRowIsIdentifier, groupRowLabel } from "./lib/labels";

import type { UsageSelection } from "./lib/drilldown";
import type { UsageGroupBy, UsageGroupRow } from "@/lib/types";

const COL = {
  unit: "w-24 text-right sm:text-left",
  quantity: "w-24 text-right",
  cost: "w-20 text-right",
  events: "w-14 text-right",
};

const COLUMN_WIDTHS = [COL.unit, COL.quantity, COL.cost, COL.events];

type UsageGroupTableProps = {
  groupBy: UsageGroupBy;
  groups: UsageGroupRow[];
  selection: UsageSelection | null;
  onSelect: (selection: UsageSelection | null) => void;
  loading: boolean;
};

/**
 * One row per `(group, unit)` — the shape the API serves, kept intact.
 *
 * A model billed in tokens for chat and in read units for a store read has two
 * rows here on purpose; merging them would print a quantity nobody measured.
 * Selecting a row opens the events behind it.
 */
export function UsageGroupTable({
  groupBy,
  groups,
  selection,
  onSelect,
  loading,
}: UsageGroupTableProps) {
  const mono = groupRowIsIdentifier(groupBy);

  return (
    <section aria-label="Usage breakdown" className="card-surface">
      <DataRowHeader
        title={groupBy === "model" ? "Model" : groupBy === "user" ? "User" : "Group"}
        columns={[
          <InstrumentLabel key="unit" className={COL.unit}>
            Unit
          </InstrumentLabel>,
          <InstrumentLabel key="quantity" className={COL.quantity}>
            Quantity
          </InstrumentLabel>,
          <InstrumentLabel key="cost" className={COL.cost}>
            Cost
          </InstrumentLabel>,
          <InstrumentLabel key="events" className={COL.events}>
            Events
          </InstrumentLabel>,
        ]}
      />
      {loading && groups.length === 0 ? (
        <DataRowSkeleton label="Loading usage breakdown" columnWidths={COLUMN_WIDTHS} />
      ) : groups.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">No usage recorded in this range.</p>
      ) : (
        groups.map((row) => {
          const label = groupRowLabel(groupBy, row.key, row.label);
          // An unattributed group has no key, so no filter selects exactly its
          // rows — it stays a fact rather than a dead drill-down.
          const selectable = row.key !== null;
          const open = selection?.key === row.key && selection?.groupBy === groupBy;
          return (
            <DataRow
              key={`${row.key ?? "none"}-${row.unit}`}
              selected={open}
              onSelect={
                selectable
                  ? () => onSelect(open ? null : { groupBy, key: row.key as string, label })
                  : undefined
              }
              title={<span className={cn(mono && "font-mono")}>{label}</span>}
              columns={[
                <span key="unit" className={cn("text-instrument text-muted", COL.unit)}>
                  {UNIT_LABELS[row.unit]}
                </span>,
                <span key="quantity" className={cn("font-mono tabular-nums", COL.quantity)}>
                  {formatCount(row.quantity)}
                </span>,
                <span
                  key="cost"
                  className={cn(
                    "font-mono tabular-nums",
                    row.cost_usd === null && "text-muted",
                    COL.cost,
                  )}
                >
                  {formatCostCell(row.cost_usd)}
                </span>,
                <span key="events" className={cn("font-mono tabular-nums text-meta", COL.events)}>
                  {formatCount(row.event_count)}
                </span>,
              ]}
            />
          );
        })
      )}
    </section>
  );
}
