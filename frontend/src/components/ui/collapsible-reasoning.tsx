"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Chip } from "@/components/ui/chip";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import type { ReasoningTraceSegment } from "@/lib/types";

interface CollapsibleReasoningProps {
  segments: ReasoningTraceSegment[];
  messageId: string;
  subtitle?: string;
  isAutoOpen?: boolean;
  preventAutoClose?: boolean;
  onManualToggle?: (messageId: string, isOpen: boolean) => void;
  title?: string;
  className?: string;
}

/**
 * A model's reasoning steps, collapsed by default.
 *
 * It wears the embed stage's colour because that is the stage the console
 * already uses for a model thinking, so the same fact reads the same way in the
 * transcript, the trace viewer, and the pipeline editor.
 */
export function CollapsibleReasoning({
  segments,
  messageId,
  subtitle,
  isAutoOpen = false,
  preventAutoClose = false,
  onManualToggle,
  title = "Reasoning",
  className,
}: CollapsibleReasoningProps) {
  const [manualState, setManualState] = useState<boolean | null>(null);
  const isOpen =
    isAutoOpen || manualState !== null ? isAutoOpen || manualState === true : preventAutoClose;

  if (!segments || segments.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-panel border border-stage-embed/40 bg-stage-embed/10",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => {
          const next = !isOpen;
          setManualState(next);
          onManualToggle?.(messageId, next);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-80 ease-standard hover:bg-stage-embed/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
        aria-expanded={isOpen}
      >
        <InstrumentLabel className="text-stage-embed">{title}</InstrumentLabel>
        {subtitle ? <span className="min-w-0 truncate text-ui text-body">{subtitle}</span> : null}
        <Chip tone="embed" dot={false} className="ml-auto shrink-0">
          {`${segments.length} ${segments.length === 1 ? "step" : "steps"}`}
        </Chip>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-stage-embed transition-transform duration-140 ease-standard",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div className="divide-y divide-stage-embed/20 border-t border-stage-embed/30">
          {segments.map((segment, idx) => {
            const preferredText =
              (typeof segment.text === "string" && segment.text) ||
              (typeof segment.content === "string" && segment.content) ||
              null;
            const reasoningText =
              preferredText && preferredText.trim().length > 0
                ? preferredText
                : (preferredText ?? JSON.stringify(segment, null, 2));

            return (
              <div key={`${messageId}-reasoning-${idx}`} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <InstrumentLabel className="text-stage-embed">{`Step ${idx + 1}`}</InstrumentLabel>
                  {segment.type && (
                    <span className="font-mono text-instrument text-meta">{segment.type}</span>
                  )}
                </div>
                <pre className="mt-1 max-w-[66ch] whitespace-pre-wrap font-sans text-ui leading-relaxed text-body">
                  {reasoningText}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
