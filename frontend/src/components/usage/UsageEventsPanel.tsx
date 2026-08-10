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
import { KIND_LABELS, KIND_TONES, SURFACE_LABELS, UNIT_LABELS, formatCostCell } from "./lib/labels";

import type { UsageSelection } from "./lib/drilldown";
import type { UsageEventRead } from "@/lib/types";

const COL = {
  quantity: "w-28 text-right",
  cost: "w-20 text-right",
  when: "w-16 text-right",
};

const COLUMN_WIDTHS = [COL.quantity, COL.cost, COL.when];

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
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-head font-semibold tracking-[-0.01em] text-primary">
            {selection.label}
          </h2>
          <span className="font-mono text-instrument tabular-nums text-meta">
            {total > 0 ? `${offset + 1}–${last} of ${formatCount(total)}` : "0"}
          </span>
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
            subtitle={<EventContext event={event} />}
            columns={[
              <span key="quantity" className={cn("font-mono tabular-nums", COL.quantity)}>
                {formatCount(event.quantity)}
                <span className="ml-1 text-instrument text-meta">
                  {UNIT_LABELS[event.unit].toLowerCase()}
                </span>
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

/** Kind, surface, and the context the call was made for — linked where the app
 * has a page for it, plain text where it does not. */
function EventContext({ event }: { event: UsageEventRead }) {
  const href = usageContextHref(event.context_type, event.context_id);
  const label = usageContextLabel(event.context_type);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Chip tone={KIND_TONES[event.kind]}>{KIND_LABELS[event.kind]}</Chip>
      <span className="text-instrument text-meta">{SURFACE_LABELS[event.surface]}</span>
      {label ? (
        href ? (
          <Link
            href={href}
            className="rounded-control text-instrument text-accent-cyan transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          >
            {label}
          </Link>
        ) : (
          <span className="text-instrument text-meta">{label}</span>
        )
      ) : null}
    </span>
  );
}
