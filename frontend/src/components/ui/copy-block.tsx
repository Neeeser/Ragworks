"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">{label}</p>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-hairline px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition hover:border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {copied ? (
            <Check className="h-3 w-3 text-data-pos" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className={cn(
          "mt-2 overflow-x-auto rounded-2xl border border-hairline bg-surface-strong p-3 font-mono text-xs text-body",
          inline && "whitespace-nowrap",
        )}
      >
        {value}
      </pre>
    </div>
  );
}
