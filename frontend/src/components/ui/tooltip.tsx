"use client";

import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

type TooltipSide = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  content: string;
  children: ReactNode;
  side?: TooltipSide;
  className?: string;
};

const sideClasses: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-3",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-3",
  left: "right-full top-1/2 -translate-y-1/2 mr-3",
  right: "left-full top-1/2 -translate-y-1/2 ml-3",
};

const arrowClasses: Record<TooltipSide, string> = {
  top: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2",
  bottom: "left-1/2 bottom-full -translate-x-1/2 translate-y-1/2",
  left: "left-full top-1/2 -translate-y-1/2 -translate-x-1/2",
  right: "right-full top-1/2 -translate-y-1/2 translate-x-1/2",
};

export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  if (!content) {
    return <>{children}</>;
  }

  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-20 whitespace-nowrap rounded-2xl border border-white/10",
          "bg-slate-950/95 px-3 py-2 text-[11px] font-semibold text-slate-200",
          "shadow-[0_18px_40px_rgba(6,9,22,0.65)] backdrop-blur",
          "opacity-0 transition duration-150 group-hover:opacity-100 group-hover:scale-100",
          "group-focus-within:opacity-100 group-focus-within:scale-100",
          "origin-center scale-95",
          sideClasses[side],
          className,
        )}
      >
        {content}
        <span
          className={cn(
            "absolute h-2.5 w-2.5 rotate-45 border border-white/10 bg-slate-950/95",
            arrowClasses[side],
          )}
        />
      </span>
    </span>
  );
}
