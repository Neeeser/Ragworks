"use client";

import { cn } from "@/lib/utils";

export function TypingAnimation({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span
        className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted motion-reduce:animate-none"
        style={{ animationDelay: "0ms", animationDuration: "1.4s" }}
      />
      <span
        className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted motion-reduce:animate-none"
        style={{ animationDelay: "200ms", animationDuration: "1.4s" }}
      />
      <span
        className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted motion-reduce:animate-none"
        style={{ animationDelay: "400ms", animationDuration: "1.4s" }}
      />
    </div>
  );
}
