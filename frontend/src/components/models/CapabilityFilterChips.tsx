"use client";

import { CapabilityIcon } from "@/components/models/CapabilityIcon";
import { capabilityDescriptor } from "@/lib/model-capabilities";
import { cn } from "@/lib/utils";

import type { ModelCapabilityId } from "@/lib/model-capabilities";

/**
 * Multi-select capability filters over a model catalog.
 *
 * Filtering by what a model can do is the narrowing users actually want —
 * "the ones that take images and call tools" — which sorting by price never
 * answered. Only capabilities present in the catalog are offered, so a chip is
 * never a dead control advertising something no connected provider serves.
 */
export function CapabilityFilterChips({
  available,
  selected,
  onToggle,
  className,
}: {
  available: ModelCapabilityId[];
  selected: ModelCapabilityId[];
  onToggle: (capability: ModelCapabilityId) => void;
  className?: string;
}) {
  if (available.length === 0) {
    return null;
  }
  const active = new Set(selected);
  return (
    <div
      className={cn(
        // One scrolling row on a phone, where wrapping would push the list
        // itself below the fold; wrapped rows once there is width for them.
        "flex items-center gap-1 overflow-x-auto lg:flex-wrap lg:overflow-visible",
        className,
      )}
      role="group"
      aria-label="Filter models by capability"
    >
      {available.map((capability) => {
        const descriptor = capabilityDescriptor(capability);
        const isActive = active.has(capability);
        return (
          <button
            key={capability}
            type="button"
            aria-pressed={isActive}
            onClick={() => onToggle(capability)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-instrument transition-colors duration-80 ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              isActive
                ? "border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan"
                : "border-hairline bg-surface text-muted hover:border-strong hover:text-body",
            )}
          >
            <CapabilityIcon capability={capability} decorative />
            {descriptor.label}
          </button>
        );
      })}
    </div>
  );
}
