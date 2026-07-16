"use client";

import { ArrowRight, FileText } from "lucide-react";
import { useState } from "react";

import { TraceItemRow } from "@/components/traces/values/TraceItemRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

type InspectableTraceItemProps = {
  itemId: string;
  focused: boolean;
  onFocusItem?: (itemId: string) => void;
  onOpenItem?: (itemId: string) => void;
  children: ReactNode;
};

/** Compact node-data row with explicit local inspection and artifact actions. */
export function InspectableTraceItem({
  itemId,
  focused,
  onFocusItem,
  onOpenItem,
  children,
}: InspectableTraceItemProps) {
  const [expanded, setExpanded] = useState(false);
  if (!onOpenItem) {
    return (
      <TraceItemRow
        itemId={itemId}
        focused={focused}
        onFocusItem={onFocusItem}
        className="w-full rounded-xl border border-hairline bg-canvas p-2.5 text-left"
      >
        {children}
      </TraceItemRow>
    );
  }
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-hairline bg-canvas",
        focused && "border-accent-cyan/70 bg-accent-cyan/10",
      )}
      data-focused={focused || undefined}
    >
      <button
        type="button"
        aria-label={`Inspect result ${itemId}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="w-full p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-violet"
      >
        {children}
      </button>
      {expanded ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-hairline px-2.5 py-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Open chunk ${itemId}`}
            onClick={() => onOpenItem(itemId)}
            className="gap-1.5"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Open chunk
          </Button>
          {onFocusItem && !focused ? (
            <Button
              size="sm"
              aria-label={`Trace this result ${itemId}`}
              onClick={() => onFocusItem(itemId)}
              className="gap-1.5"
            >
              Trace this result
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
