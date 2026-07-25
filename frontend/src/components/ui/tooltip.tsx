"use client";

import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

type TooltipSide = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  content: string;
  children: ReactNode;
  side?: TooltipSide;
  className?: string;
  triggerClassName?: string;
  triggerElement?: "div" | "span";
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

export function Tooltip({
  content,
  children,
  side = "top",
  className,
  triggerClassName,
  triggerElement: Trigger = "span",
}: TooltipProps) {
  if (!content) {
    return <>{children}</>;
  }

  return (
    <Trigger className={cn("group relative inline-flex", triggerClassName)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          // w-max + max-w keeps short labels on one line while long
          // descriptions wrap instead of running off the viewport.
          "pointer-events-none absolute z-20 w-max max-w-72 whitespace-normal rounded-panel border border-hairline",
          "bg-canvas-raised px-2 py-1 text-left text-ui font-medium leading-snug text-body",
          "shadow-elevation-2",
          "opacity-0 transition duration-120 ease-decel group-hover:opacity-100 group-hover:scale-100",
          // :focus-visible, not :focus-within — a mouse click leaves the trigger
          // focused, which kept the tooltip pinned open until the next click.
          // Keyboard focus still reveals it; a click no longer strands it.
          "group-has-[:focus-visible]:scale-100 group-has-[:focus-visible]:opacity-100",
          "origin-center scale-95",
          sideClasses[side],
          className,
        )}
      >
        {content}
        <span
          className={cn(
            "absolute h-2.5 w-2.5 rotate-45 border border-hairline bg-canvas-raised/95",
            arrowClasses[side],
          )}
        />
      </span>
    </Trigger>
  );
}
