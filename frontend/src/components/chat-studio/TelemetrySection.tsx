"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

interface TelemetrySectionProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  sectionId?: string;
  overrideActive?: boolean;
  headerAction?: ReactNode;
  isDragging?: boolean;
  children: ReactNode;
}

/**
 * One collapsible block of run settings.
 *
 * A section whose value differs from the default carries a positive node dot,
 * because "this run is not on defaults" is the fact a user scanning the pane is
 * looking for.
 *
 * An open section is two materials, not one: the header keeps a raised fill and
 * the body recesses to the canvas. Painting both at one level is what makes a
 * long pane read as a single wash — the rows inside a section carry translucent
 * fills, so they only separate when the surface behind them steps back.
 */
export const TelemetrySection = ({
  title,
  description,
  icon,
  isOpen,
  onToggle,
  sectionId,
  overrideActive,
  headerAction,
  isDragging = false,
  children,
}: TelemetrySectionProps) => (
  <div
    id={sectionId}
    className={cn(
      "overflow-hidden rounded-control border transition-colors duration-140 ease-standard",
      isDragging
        ? "border-data-pos/60 bg-data-pos/5"
        : isOpen
          ? "border-strong bg-canvas shadow-elevation-1"
          : "border-hairline hover:border-strong",
    )}
  >
    <div
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 transition-colors duration-140 ease-standard",
        isOpen && !isDragging && "border-b border-hairline bg-surface-strong",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-ui font-medium text-primary">{title}</span>
            {overrideActive && <StatusDot tone="pos" />}
          </span>
          {description && (
            <span className="block truncate text-instrument text-meta">{description}</span>
          )}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {headerAction}
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${title} toggle`}
          className="flex h-6 w-6 items-center justify-center rounded-control text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
    </div>
    {isOpen && <div className="space-y-3 p-3">{children}</div>}
  </div>
);
