"use client";

import { AlertCircle, Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { UploadItem } from "@/components/files/hooks/use-file-uploads";

type UploadTrayProps = {
  items: UploadItem[];
  onDismiss: () => void;
};

function StatusIcon({ status }: { status: UploadItem["status"] }) {
  if (status === "uploading") {
    return (
      <Loader2
        className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-cyan motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  if (status === "done") {
    return <Check className="h-3.5 w-3.5 shrink-0 text-data-pos" aria-hidden />;
  }
  return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-data-neg" aria-hidden />;
}

/** In-flight uploads, bottom-right, newest last. A transient surface, so it is raised. */
export function UploadTray({ items, onDismiss }: UploadTrayProps) {
  if (items.length === 0) {
    return null;
  }
  const done = items.filter((item) => item.status !== "uploading").length;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 overflow-hidden rounded-panel border border-hairline bg-canvas-raised shadow-elevation-2">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-1.5">
        <InstrumentLabel className="tabular-nums">{`Uploads ${done}/${items.length}`}</InstrumentLabel>
        <Tooltip content="Dismiss finished uploads">
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            aria-label="Dismiss completed uploads"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </Tooltip>
      </div>
      <ul className="max-h-56 overflow-y-auto">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-2 border-b border-hairline px-3 py-1.5 last:border-b-0"
          >
            <StatusIcon status={item.status} />
            <Tooltip content={item.error ?? item.name} triggerClassName="min-w-0 flex-1">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-ui",
                  item.status === "error" ? "text-data-neg" : "text-body",
                )}
              >
                {item.name}
              </span>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}
