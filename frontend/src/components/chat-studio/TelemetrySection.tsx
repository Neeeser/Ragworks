"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

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
    className={`overflow-hidden rounded-2xl border bg-surface transition-colors ${
      isDragging
        ? "border-data-pos/60 bg-data-pos/5"
        : isOpen
          ? "border-strong bg-surface-strong"
          : "border-hairline"
    }`}
  >
    <div
      className={`flex w-full items-center justify-between gap-3 px-4 py-3 transition hover:bg-surface-strong ${
        isOpen ? "border-b border-hairline" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex flex-1 items-center gap-2 text-left"
      >
        {icon && <span className="text-muted">{icon}</span>}
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted">{title}</p>
            {overrideActive && <span className="h-2 w-2 rounded-full bg-data-pos" />}
          </div>
          {description && <p className="text-[11px] text-body">{description}</p>}
        </div>
      </button>
      <div className="flex items-center gap-2">
        {headerAction}
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${title} toggle`}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-surface-strong"
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
    </div>
    {isOpen && <div className="space-y-3 px-4 pb-4 pt-3">{children}</div>}
  </div>
);
