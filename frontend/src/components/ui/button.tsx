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
        "rounded-full font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed",
        {
          primary: "bg-accent-violet text-white hover:brightness-110 shadow-glow",
          secondary:
            "border border-hairline bg-surface text-primary hover:border-strong hover:bg-surface-strong",
          ghost: "text-muted hover:text-primary hover:bg-surface",
        }[variant],
        {
          sm: "px-3 py-1.5 text-sm",
          md: "px-4 py-2 text-sm",
          lg: "px-5 py-3 text-base",
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
