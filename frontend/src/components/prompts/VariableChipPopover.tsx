"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { TextInput } from "@/components/ui/field";
import { popoverSurfaceClass } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { ChipTarget } from "./lib/codemirror";
import type { PromptCatalog } from "@/lib/types";

interface VariableChipPopoverProps {
  target: ChipTarget;
  catalog: PromptCatalog | null;
  /** The sample value the chip is currently showing. */
  value: string;
  onValueChange: (value: string) => void;
  onSwap: (name: string) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 288;

/**
 * The editor for one variable reference, opened by clicking its chip.
 *
 * Two things are editable here because they are the two things a chip can
 * be wrong about: the sample value it is showing, and which variable it
 * points at. It portals to the body and positions from the chip's viewport
 * rect — an absolutely-positioned popover would be clipped by the panel's
 * own scroll container.
 */
export function VariableChipPopover({
  target,
  catalog,
  value,
  onValueChange,
  onSwap,
  onClose,
}: VariableChipPopoverProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const alternatives = (catalog?.variables ?? []).filter(
    (variable) => variable.name !== target.name,
  );
  const left = Math.min(target.rect.left, window.innerWidth - POPOVER_WIDTH - 8);
  const top = target.rect.bottom + 6;

  return createPortal(
    <div
      ref={hostRef}
      role="dialog"
      aria-label={`Variable ${target.name}`}
      style={{ left: Math.max(8, left), top, width: POPOVER_WIDTH }}
      className={cn(popoverSurfaceClass, "fixed z-50 space-y-2 p-2")}
    >
      <div className="space-y-1">
        <label
          htmlFor="chip-sample-value"
          className="block font-mono text-instrument text-accent-violet"
        >
          {`{{${target.name}}}`}
        </label>
        <TextInput
          id="chip-sample-value"
          autoFocus
          aria-label={`Sample value for ${target.name}`}
          placeholder="Sample value"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <p className="text-instrument text-meta">
          Used by the preview and the test bench. Not saved with the prompt.
        </p>
      </div>
      {alternatives.length > 0 && (
        <div className="space-y-1 border-t border-hairline pt-2">
          <span className="text-instrument font-medium text-muted">Point at instead</span>
          <div className="flex flex-wrap gap-1">
            {alternatives.map((variable) => (
              <button
                key={variable.name}
                type="button"
                onClick={() => onSwap(variable.name)}
                className="rounded-chip border border-hairline px-1.5 py-0.5 font-mono text-instrument text-body transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
              >
                {`{{${variable.name}}}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
