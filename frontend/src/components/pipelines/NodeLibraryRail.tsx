"use client";

import { cn } from "@/lib/utils";

import { Tooltip } from "../ui/tooltip";

import { getNodeFamilyLabel, getNodeFamilyStyles, type NodeFamily } from "./lib/pipeline-theme";

type NodeLibraryRailProps = {
  /** Families present in the catalog, with node counts, in display order. */
  families: Array<{ family: NodeFamily; count: number }>;
  /** `null` = the All filter. */
  active: NodeFamily | null;
  onSelect: (family: NodeFamily | null) => void;
};

const slotClass = (selected: boolean) =>
  cn(
    "relative flex h-8 w-[34px] items-center justify-center rounded-control transition-colors duration-80 ease-standard",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
    selected
      ? "bg-surface-strong shadow-[inset_0_0_0_1px_var(--border-strong)]"
      : "hover:bg-surface",
  );

/** The lit filter's edge marker — where-you-are, same mark as active nav. */
const ActiveWire = () => (
  <span
    aria-hidden
    className="trace-wire absolute -left-1.5 bottom-1.5 top-1.5 w-0.5 rounded-full"
  />
);

/**
 * The Nodes tab's category rail: an "All" slot plus one square stage dot per
 * family, acting as a filter over the panel beside it. Every slot names itself
 * on hover/focus (label + count), so no category hides behind a blind dot.
 */
export function NodeLibraryRail({ families, active, onSelect }: NodeLibraryRailProps) {
  return (
    <div
      role="group"
      aria-label="Node categories"
      // Hidden at phone width: inside the bottom sheet the grouped headers +
      // search carry navigation, and a squeezed rail is the cramp this layout
      // removes. It returns from `sm` up (tablet sheets and the desktop rail).
      className="hidden w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-hairline bg-canvas-raised px-1 py-1.5 sm:flex"
    >
      <Tooltip content="All categories" side="right">
        <button
          type="button"
          aria-pressed={active === null}
          aria-label="All categories"
          onClick={() => onSelect(null)}
          className={cn(
            slotClass(active === null),
            "text-instrument font-semibold",
            active === null ? "text-primary" : "text-muted",
          )}
        >
          {active === null ? <ActiveWire /> : null}
          All
        </button>
      </Tooltip>
      <div aria-hidden className="my-1 h-px w-6 shrink-0 bg-hairline" />
      {families.map(({ family, count }) => {
        const selected = active === family;
        const styles = getNodeFamilyStyles(family);
        return (
          <Tooltip key={family} content={`${getNodeFamilyLabel(family)} · ${count}`} side="right">
            <button
              type="button"
              aria-pressed={selected}
              aria-label={`${getNodeFamilyLabel(family)} (${count})`}
              onClick={() => onSelect(selected ? null : family)}
              className={slotClass(selected)}
            >
              {selected ? <ActiveWire /> : null}
              <span aria-hidden className={cn("h-2 w-2 rounded-[2px]", styles.accent)} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
