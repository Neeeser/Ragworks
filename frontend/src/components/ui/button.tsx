"use client";

import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function Button({
  className,
  children,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        // Console defaults: 4px radius, 80ms pointer feedback, no glow. The
        // glow and pill shape belong to the landing surface, which uses the
        // link-CTA recipes rather than this component.
        "rounded-control font-medium transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60",
        {
          primary: "bg-accent-violet text-white hover:brightness-110",
          secondary:
            "border border-hairline bg-surface text-primary hover:border-strong hover:bg-surface-strong",
          ghost: "text-muted hover:bg-surface hover:text-primary",
        }[variant],
        {
          sm: "px-2 py-1 text-ui",
          md: "px-3 py-1.5 text-ui",
          lg: "px-4 py-2 text-num",
        }[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {loading ? <Loader className="h-3.5 w-3.5" /> : null}
        {children}
      </span>
    </button>
  );
}
