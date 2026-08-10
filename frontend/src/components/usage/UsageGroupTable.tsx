"use client";

import { DataRow, DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  EMPTY_RANGE_COPY,
  GROUP_BY_LABELS,
  UNIT_LABELS,
  formatCostCell,
  groupRowIsIdentifier,
  groupRowLabel,
} from "./lib/labels";

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
 *
 * Selection, though, is by *group*: the events endpoint carries no unit filter,
 * so every one of a group's rows opens the same list and every one of them
 * highlights — the highlight describes what the drill-down actually covers
 * rather than implying a per-unit list nobody can serve.
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
      {/* Below `sm` the row's columns wrap onto their own line at their own
          widths, which the header's cannot line up with — the two wrap at
          different points and the labels read as scrambled against the values.
          The header is a desktop affordance; on a phone each value carries its
          own inline label instead. */}
      <div className="hidden sm:block">
        <DataRowHeader
          title={GROUP_BY_LABELS[groupBy]}
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
      </div>
      {loading && groups.length === 0 ? (
        <DataRowSkeleton label="Loading usage breakdown" columnWidths={COLUMN_WIDTHS} />
      ) : groups.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">{EMPTY_RANGE_COPY}</p>
      ) : (
        groups.map((row) => {
          const label = groupRowLabel(groupBy, row.key, row.label);
          // An unattributed group has no key, so no filter selects exactly its
          // rows — it stays a fact rather than a dead drill-down.
          const key = row.key;
          const open = key !== null && selection?.key === key && selection?.groupBy === groupBy;
          return (
            <DataRow
              key={`${key ?? "none"}-${row.unit}`}
              selected={open}
              onSelect={key === null ? undefined : () => onSelect(open ? null : { groupBy, key })}
              title={<span className={cn(mono && "font-mono")}>{label}</span>}
              columns={[
                <span key="unit" className={cn("text-instrument text-muted", COL.unit)}>
                  {UNIT_LABELS[row.unit]}
                </span>,
                <span key="quantity" className={cn("font-mono tabular-nums", COL.quantity)}>
                  <CellLabel>Qty</CellLabel>
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
                  <CellLabel>Cost</CellLabel>
                  {formatCostCell(row.cost_usd)}
                </span>,
                <span key="events" className={cn("font-mono tabular-nums text-meta", COL.events)}>
                  <CellLabel>Events</CellLabel>
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

/** The column's name, carried on the value itself where the header is hidden.
 * The unit cell needs none — it prints its own name. */
function CellLabel({ children }: { children: string }) {
  return <span className="mr-1 font-sans text-instrument text-meta sm:hidden">{children}</span>;
}
