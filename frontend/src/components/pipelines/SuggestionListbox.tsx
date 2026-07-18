"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import type { Suggestion } from "./lib/expression-suggest";
import type { RefObject } from "react";

type SuggestionListboxProps = {
  listId: string;
  /** The input the dropdown anchors under; repositions on scroll/resize. */
  anchorRef: RefObject<HTMLElement | null>;
  suggestions: Suggestion[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onAccept: (suggestion: Suggestion) => void;
};

/**
 * The expression suggestion dropdown: a portaled listbox (drawer overflow
 * can't clip it) anchored under its input. Rows show the name, a source
 * badge, and the type + current static value. Acceptance happens on
 * mousedown so the anchored input never blurs first.
 */
export function SuggestionListbox({
  listId,
  anchorRef,
  suggestions,
  activeIndex,
  onActiveIndexChange,
  onAccept,
}: SuggestionListboxProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateRect = useCallback(() => {
    const element = anchorRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    setRect({ top: bounds.bottom + 4, left: bounds.left, width: bounds.width });
  }, [anchorRef]);

  useEffect(() => {
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [updateRect]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!rect || suggestions.length === 0) return null;

  return createPortal(
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label="Expression suggestions"
      style={{ top: rect.top, left: rect.left, minWidth: rect.width }}
      className="fixed z-[70] max-h-64 overflow-y-auto rounded-2xl border border-hairline bg-canvas-raised p-1 shadow-elevation-2"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={`${suggestion.kind}:${suggestion.name}`}
          id={`${listId}-${index}`}
          data-index={index}
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => {
            event.preventDefault();
            onAccept(suggestion);
          }}
          onMouseEnter={() => onActiveIndexChange(index)}
          className={cn(
            "flex cursor-pointer items-baseline justify-between gap-4 rounded-xl px-3 py-1.5",
            index === activeIndex ? "bg-surface-strong" : undefined,
          )}
        >
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-[13px] text-body">
              {suggestion.kind === "function" ? suggestion.detail : suggestion.name}
            </span>
            <span
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.2em]",
                suggestion.badge === "input" ? "text-accent-cyan" : "text-meta",
              )}
            >
              {suggestion.badge}
            </span>
          </span>
          {suggestion.kind === "function" ? null : (
            <span className="font-mono text-[11px] text-meta">
              {suggestion.preview != null
                ? `${suggestion.detail} = ${suggestion.preview}`
                : suggestion.detail}
            </span>
          )}
        </li>
      ))}
    </ul>,
    document.body,
  );
}
