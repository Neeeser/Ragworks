"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { VectorIndex } from "@/lib/types";

type IndexListPanelProps = {
  indexes: VectorIndex[];
  loading: boolean;
  viewMode: "details" | "create";
  selectedName: string | null;
  onSelectIndex: (name: string) => void;
  onSelectCreate: () => void;
};

/** The left-hand rail of the index manager: the scrollable list of existing indexes
 * plus the "Create index" action that switches the details panel into create mode. */
export function IndexListPanel({
  indexes,
  loading,
  viewMode,
  selectedName,
  onSelectIndex,
  onSelectCreate,
}: IndexListPanelProps) {
  return (
    <div className="space-y-2">
      <Panel className="overflow-hidden">
        <div className="flex h-8 items-center border-b border-hairline px-3">
          <InstrumentLabel>Indexes</InstrumentLabel>
        </div>
        {loading ? (
          <div aria-busy>
            {[0, 1, 2].map((row) => (
              <div key={row} className="border-b border-hairline px-3 py-2 last:border-b-0">
                <Skeleton className="h-2 max-w-32" />
                <Skeleton className="mt-1.5 h-2 max-w-20" />
              </div>
            ))}
            <span className="sr-only">Loading indexes</span>
          </div>
        ) : indexes.length === 0 ? (
          <p className="p-8 text-center text-ui text-muted">No indexes on this backend yet.</p>
        ) : (
          indexes.map((index) => {
            const isActive = viewMode === "details" && index.name === selectedName;
            return (
              <button
                key={index.name}
                type="button"
                onClick={() => onSelectIndex(index.name)}
                className={cn(
                  "block w-full border-b border-hairline px-3 py-2 text-left transition-colors duration-80 ease-standard last:border-b-0",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
                  isActive ? "bg-accent-violet/10" : "hover:bg-surface",
                )}
              >
                {/* An index name is a literal — mono, verbatim. */}
                <span className="block truncate font-mono text-ui text-primary">{index.name}</span>
                <span className="block truncate text-instrument text-meta">
                  {index.vector_type ?? "dense"} · {index.metric ?? "cosine"}
                </span>
              </button>
            );
          })
        )}
      </Panel>
      <Button
        size="sm"
        variant={viewMode === "create" ? "primary" : "secondary"}
        onClick={onSelectCreate}
        className="w-full"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Create index
      </Button>
    </div>
  );
}
