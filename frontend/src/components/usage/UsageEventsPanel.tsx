"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DataRow, DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/datetime";
import { formatCount, formatTimeAgoCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

import { usageContextHref, usageContextLabel } from "./lib/context-links";
import {
  KIND_LABELS,
  KIND_TONES,
  SURFACE_LABELS,
  UNIT_LABELS,
  formatCostCell,
  formatQuantity,
} from "./lib/labels";

import type { UsageSelection } from "./lib/drilldown";
import type { UsageEventRead } from "@/lib/types";

/**
 * Each fact is its own column rather than a run of text under the model name.
 *
 * `DataRow`'s subtitle is a single truncating line, so a wrapping cluster of
 * chip + surface + link placed there is clipped instead of reflowing; as
 * columns they wrap onto their own line below `sm`, which is what the row was
 * built to do.
 */
const COL = {
  kind: "w-28",
  context: "w-32",
  quantity: "w-32 text-right",
  cost: "w-20 text-right",
  when: "w-14 text-right",
};

const COLUMN_WIDTHS = [COL.kind, COL.context, COL.quantity, COL.cost, COL.when];

type UsageEventsPanelProps = {
  selection: UsageSelection;
  events: UsageEventRead[];
  total: number;
  offset: number;
  loading: boolean;
  error: string | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
};

/** The ledger rows behind one breakdown group, newest first. */
export function UsageEventsPanel({
  selection,
  events,
  total,
  offset,
  loading,
  error,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onClose,
}: UsageEventsPanelProps) {
  const last = Math.min(offset + events.length, total);
  return (
    <section aria-label={`Events for ${selection.label}`} className="card-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate text-head font-semibold tracking-[-0.01em] text-primary">
              {selection.label}
            </h2>
            <span className="font-mono text-instrument tabular-nums text-meta">
              {total > 0 ? `${offset + 1}–${last} of ${formatCount(total)}` : "0"}
            </span>
          </div>
          {/* A group measured in more than one unit lists every unit's events
              here, so the panel says which ones it is covering. */}
          {selection.units.length > 1 ? (
            <span className="text-instrument text-meta">
              {selection.units.map((unit) => UNIT_LABELS[unit]).join(" · ")}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onPrevious} disabled={!hasPrevious}>
            Previous
          </Button>
          <Button variant="ghost" size="sm" onClick={onNext} disabled={!hasNext}>
            Next
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="p-3 text-ui text-data-neg">
          {error}
        </p>
      ) : null}

      <DataRowHeader
        title="Model"
        columns={[
          <InstrumentLabel key="kind" className={COL.kind}>
            Kind
          </InstrumentLabel>,
          <InstrumentLabel key="context" className={COL.context}>
            Context
          </InstrumentLabel>,
          <InstrumentLabel key="quantity" className={COL.quantity}>
            Quantity
          </InstrumentLabel>,
          <InstrumentLabel key="cost" className={COL.cost}>
            Cost
          </InstrumentLabel>,
          <InstrumentLabel key="when" className={COL.when}>
            When
          </InstrumentLabel>,
        ]}
      />
      {loading && events.length === 0 ? (
        <DataRowSkeleton label="Loading events" hasSubtitle columnWidths={COLUMN_WIDTHS} />
      ) : events.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">
          No events recorded for this group in the range.
        </p>
      ) : (
        events.map((event) => (
          <DataRow
            key={event.id}
            title={<span className="font-mono">{event.model}</span>}
            subtitle={SURFACE_LABELS[event.surface]}
            columns={[
              <span key="kind" className={cn("min-w-0", COL.kind)}>
                <Chip tone={KIND_TONES[event.kind]}>{KIND_LABELS[event.kind]}</Chip>
              </span>,
              <EventContextCell key="context" event={event} />,
              <span
                key="quantity"
                className={cn("truncate font-mono text-instrument tabular-nums", COL.quantity)}
              >
                {formatQuantity(event.quantity, event.unit)}
              </span>,
              <span
                key="cost"
                className={cn(
                  "font-mono tabular-nums",
                  event.cost_usd === null && "text-muted",
                  COL.cost,
                )}
              >
                {formatCostCell(event.cost_usd)}
              </span>,
              <Tooltip
                key="when"
                content={formatDateTime(event.created_at)}
                triggerClassName={`justify-end ${COL.when}`}
              >
                <span className="font-mono tabular-nums text-meta">
                  {formatTimeAgoCompact(event.created_at)}
                </span>
              </Tooltip>,
            ]}
          />
        ))
      )}
    </section>
  );
}

/** What the call was made for — linked where the app has a page for it, plain
 * text where it does not, and an em-dash where the ledger recorded none. */
function EventContextCell({ event }: { event: UsageEventRead }) {
  const href = usageContextHref(event.context_type, event.context_id);
  const label = usageContextLabel(event.context_type);
  if (!label) {
    return <span className={cn("text-muted", COL.context)}>—</span>;
  }
  if (!href) {
    return <span className={cn("truncate text-instrument text-meta", COL.context)}>{label}</span>;
  }
  return (
    <Link
      href={href}
      className={cn(
        "truncate rounded-control text-instrument text-accent-cyan transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
        COL.context,
      )}
    >
      {label}
    </Link>
  );
}
