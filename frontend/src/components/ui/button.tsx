"use client";

import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  /**
   * The soft accent halo. Budget: ONE glowing button per view — the page's
   * primary action (`New collection`, `Upload`) — never every primary variant.
   */
  glow?: boolean;
}

export function Button({
  className,
  children,
  variant = "primary",
  size = "md",
  loading = false,
  glow = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        // Console defaults: 6px radius, 80ms pointer feedback, press scale.
        // The pill shape belongs to the landing surface's link-CTA recipes.
        "rounded-control font-medium transition duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
        {
          // A white top-light over the accent fill, so it stays correct when a
          // palette swaps the accent hue.
          primary:
            "bg-accent-violet text-white [background-image:linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0)_55%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:brightness-110",
          secondary:
            "border border-hairline bg-surface text-primary hover:border-strong hover:bg-surface-strong",
          ghost: "text-muted hover:bg-surface hover:text-primary",
        }[variant],
        // One combined arbitrary shadow: tailwind-merge treats it and the
        // primary variant's inset shadow as conflicting box-shadows, so the
        // glow version must carry the inset highlight itself.
        glow &&
          variant === "primary" &&
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_30px_-10px_var(--glow)]",
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
