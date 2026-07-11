"use client";

import { AlertCircle, Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

import type { UploadItem } from "@/components/files/hooks/use-file-uploads";

type UploadTrayProps = {
  items: UploadItem[];
  onDismiss: () => void;
};

/** Floating queue of in-flight uploads, bottom-right, newest last. */
export function UploadTray({ items, onDismiss }: UploadTrayProps) {
  if (items.length === 0) {
    return null;
  }
  const done = items.filter((item) => item.status !== "uploading").length;

  return (
    <div className="fixed bottom-6 right-6 z-40 w-80 overflow-hidden rounded-3xl border border-hairline bg-canvas-raised shadow-elevation-2">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Uploads {done}/{items.length}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss completed uploads"
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto p-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 rounded-2xl px-2 py-1.5">
            {item.status === "uploading" && (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-cyan motion-reduce:animate-none"
                aria-hidden
              />
            )}
            {item.status === "done" && (
              <Check className="h-3.5 w-3.5 shrink-0 text-data-pos" aria-hidden />
            )}
            {item.status === "error" && (
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-data-neg" aria-hidden />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                item.status === "error" ? "text-data-neg" : "text-body",
              )}
              title={item.error ?? item.name}
            >
              {item.name}
              {item.error ? ` — ${item.error}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
