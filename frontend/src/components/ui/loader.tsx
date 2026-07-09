"use client";

import { cn } from "@/lib/utils";

/**
 * Spinner that inherits the current text color (border-current), so it reads
 * correctly on any surface: white on a violet button, slate on the canvas.
 */
export function Loader({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70 motion-reduce:animate-none",
        className,
      )}
    />
  );
}
