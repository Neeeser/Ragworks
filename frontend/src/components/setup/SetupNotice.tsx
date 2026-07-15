"use client";

import { cn } from "@/lib/utils";

/** Inline setup feedback; renders nothing when clear. */
export function SetupNotice({
  message,
  tone = "error",
}: {
  message: string | null;
  tone?: "error" | "warning";
}) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "warning"
          ? "border-data-warn/40 bg-data-warn/10 text-data-warn"
          : "border-data-neg/40 bg-data-neg/10 text-data-neg",
      )}
    >
      {message}
    </p>
  );
}
