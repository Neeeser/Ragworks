"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

type CopyBlockProps = {
  label: string;
  value: string;
  /** Render on one line with the value truncated (URLs, keys). */
  inline?: boolean;
  className?: string;
};

/**
 * A monospace value with a copy button.
 *
 * Used wherever the user's next step is pasting something elsewhere (an MCP
 * endpoint, a key, a client config block), so the copy affordance and its
 * confirmation behave the same everywhere.
 */
export function CopyBlock({ label, value, inline = false, className }: CopyBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-3">
        <InstrumentLabel>{label}</InstrumentLabel>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void copy()}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? (
            <Check className="h-3 w-3 text-data-pos" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        className={cn(
          "mt-1 overflow-x-auto rounded-control border border-hairline bg-surface-strong p-3 font-mono text-instrument leading-relaxed text-body",
          inline && "whitespace-nowrap",
        )}
      >
        {value}
      </pre>
    </div>
  );
}
