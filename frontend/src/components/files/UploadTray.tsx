"use client";

import { AlertCircle, Check, Loader2, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { popoverSurfaceClass } from "@/components/ui/panel";
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

/** How long a fully-successful tray stays up before clearing itself. */
const SETTLED_DISMISS_MS = 4000;

/** In-flight uploads, bottom-right, newest last. A transient surface, so it is raised. */
export function UploadTray({ items, onDismiss }: UploadTrayProps) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  // It floats over the file rows and their actions, so a tray left up after
  // every upload succeeded swallows clicks on the page beneath it. A tray
  // holding a failure stays until dismissed — that one is still reporting.
  const allSucceeded = items.length > 0 && items.every((item) => item.status === "done");
  useEffect(() => {
    if (!allSucceeded) return;
    const timer = setTimeout(() => dismiss.current(), SETTLED_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [allSucceeded]);

  if (items.length === 0) {
    return null;
  }
  const done = items.filter((item) => item.status !== "uploading").length;

  return (
    <div className={cn(popoverSurfaceClass, "fixed bottom-4 right-4 z-40 w-72 overflow-hidden")}>
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
