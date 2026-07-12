"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

export type ContextMenuAction = {
  type?: "item";
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Small trailing hint, e.g. the clipboard item a Paste would insert. */
  hint?: string;
};

export type ContextMenuItem = ContextMenuAction | { type: "separator" };

export type ContextMenuPosition = { x: number; y: number };

type ContextMenuProps = {
  /** Viewport coordinates to open at; null renders nothing. */
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  onClose: () => void;
};

function isAction(item: ContextMenuItem): item is ContextMenuAction {
  return item.type !== "separator";
}

/**
 * A right-click menu: fixed-positioned at the pointer, clamped to the
 * viewport, with roving arrow-key focus. Closes on Escape, outside
 * click/right-click, scroll, and resize.
 */
export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Clamp to the viewport once the menu has a measurable size. Direct style
  // writes (not state) — the unclamped position must never paint.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!position || !menu) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - height - 8))}px`;
    menu.style.visibility = "visible";
  }, [position]);

  useEffect(() => {
    if (!position) return;
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    const onPointerDown = (event: MouseEvent) => {
      if (menu && !menu.contains(event.target as Node)) onClose();
    };
    const close = () => onClose();
    document.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [position, onClose]);

  if (!position) return null;

  const moveFocus = (direction: 1 | -1) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current === -1 ? 0 : (current + direction + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Tab") {
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-50 min-w-52 rounded-2xl border border-hairline bg-canvas-raised p-1.5 shadow-elevation-2"
      style={{ left: position.x, top: position.y, visibility: "hidden" }}
    >
      {items.map((item, index) =>
        isAction(item) ? (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-sm transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
              item.danger ? "text-data-neg hover:bg-data-neg/10" : "text-body hover:bg-surface",
              item.disabled && "cursor-default opacity-40 hover:bg-transparent",
            )}
          >
            {item.icon && <item.icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
            <span className="flex-1">{item.label}</span>
            {item.hint && <span className="max-w-32 truncate text-xs text-meta">{item.hint}</span>}
          </button>
        ) : (
          <div
            key={`separator-${index}`}
            role="separator"
            className="my-1.5 border-t border-hairline"
          />
        ),
      )}
    </div>
  );
}
