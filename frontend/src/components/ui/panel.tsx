"use client";

import { cn } from "@/lib/utils";

import type { HTMLAttributes } from "react";

export function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "glass-panel border border-hairline bg-gradient-to-br from-surface via-transparent to-surface",
        className,
      )}
      {...props}
    />
  );
}
