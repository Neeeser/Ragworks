"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import type { CSSProperties, FocusEvent as ReactFocusEvent, ReactNode } from "react";

type TooltipSide = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  content: string;
  children: ReactNode;
  side?: TooltipSide;
  className?: string;
  triggerClassName?: string;
  triggerElement?: "div" | "span";
};

/** Gap between the trigger's edge and the tooltip box. */
const OFFSET = 10;

/** Anchor transform per side — position is the trigger edge; this shifts the box off it. */
const SIDE_TRANSFORM: Record<TooltipSide, string> = {
  top: "translate(-50%, -100%)",
  bottom: "translate(-50%, 0)",
  left: "translate(-100%, -50%)",
  right: "translate(0, -50%)",
};

const arrowClasses: Record<TooltipSide, string> = {
  top: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2",
  bottom: "left-1/2 bottom-full -translate-x-1/2 translate-y-1/2",
  left: "left-full top-1/2 -translate-y-1/2 -translate-x-1/2",
  right: "right-full top-1/2 -translate-y-1/2 translate-x-1/2",
};

const subscribeNever = () => () => {};

/** Portals mount only in the browser; the server snapshot keeps SSR clean. */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

function anchorFor(side: TooltipSide, rect: DOMRect): { top: number; left: number } {
  switch (side) {
    case "top":
      return { top: rect.top - OFFSET, left: rect.left + rect.width / 2 };
    case "bottom":
      return { top: rect.bottom + OFFSET, left: rect.left + rect.width / 2 };
    case "left":
      return { top: rect.top + rect.height / 2, left: rect.left - OFFSET };
    case "right":
      return { top: rect.top + rect.height / 2, left: rect.right + OFFSET };
  }
}

/**
 * A themed tooltip that is ALWAYS on top: the box portals to `document.body`
 * at a fixed position, so no pane, card, `overflow-hidden`, or sibling
 * stacking context can cover or clip it — the failure the old inline version
 * had at every pane seam.
 *
 * The box stays mounted (hidden) while closed so its text remains queryable
 * and the open transition can run; open/close follows pointer enter/leave and
 * keyboard focus/blur on the wrapper, and scrolling closes it rather than
 * letting a fixed box drift from its trigger.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
  triggerClassName,
  triggerElement: Trigger = "span",
}: TooltipProps) {
  const mounted = useMounted();
  const triggerRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setAnchor(anchorFor(side, trigger.getBoundingClientRect()));
    setOpen(true);
  }, [side]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    // Capture-phase: any scrolling ancestor moves the trigger out from under
    // a fixed-position box, so the box goes away instead of drifting.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  if (!content) {
    return <>{children}</>;
  }

  const style: CSSProperties = anchor
    ? { top: anchor.top, left: anchor.left, transform: SIDE_TRANSFORM[side] }
    : { top: -9999, left: -9999 };

  return (
    <Trigger
      ref={(node: HTMLElement | null) => {
        triggerRef.current = node;
      }}
      className={cn("inline-flex", triggerClassName)}
      onPointerEnter={show}
      onPointerLeave={hide}
      // :focus-visible only — a mouse click leaves the trigger focused, which
      // kept the old tooltip pinned open until the next click. Keyboard focus
      // still reveals it; a click no longer strands it. Engines without the
      // selector (older jsdom) fall back to showing, the safe direction.
      onFocus={(event: ReactFocusEvent<HTMLElement>) => {
        let focusVisible = true;
        try {
          focusVisible = event.target.matches(":focus-visible");
        } catch {
          focusVisible = true;
        }
        if (focusVisible) show();
      }}
      onBlur={hide}
    >
      {children}
      {mounted
        ? createPortal(
            <span
              role="tooltip"
              style={style}
              className={cn(
                // w-max + max-w keeps short labels on one line while long
                // descriptions wrap instead of running off the viewport.
                "pointer-events-none fixed z-50 w-max max-w-72 whitespace-normal rounded-panel border border-hairline",
                "bg-canvas-raised px-2 py-1 text-left text-ui font-medium leading-snug text-body",
                "shadow-elevation-2",
                "transition duration-120 ease-decel motion-reduce:transition-none",
                open ? "scale-100 opacity-100" : "scale-95 opacity-0",
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
            </span>,
            document.body,
          )
        : null}
    </Trigger>
  );
}
