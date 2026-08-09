"use client";

import { LocateFixed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";

type FocusPromptProps = {
  onFocusTopResult: () => void;
};

/**
 * Stands where the rank path renders when no result is focused.
 *
 * The per-node scores and the ingestion band both describe one item's journey,
 * so a trace opened without a chunk shows neither. Rather than leave that as an
 * unexplained absence, this states the condition and focuses the top result in
 * one click — the same action the result rows offer, at the place the reader is
 * already looking.
 */
export function FocusPrompt({ onFocusTopResult }: FocusPromptProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
      <InstrumentLabel className="shrink-0 text-meta">Rank path</InstrumentLabel>
      <p className="min-w-0 flex-1 text-ui text-body">
        Scores and the ingestion path follow one result. Pick a result to see them.
      </p>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={onFocusTopResult}>
        <LocateFixed className="h-3.5 w-3.5" aria-hidden />
        Trace top result
      </Button>
    </div>
  );
}
