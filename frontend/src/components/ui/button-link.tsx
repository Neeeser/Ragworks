"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import type { ComponentProps, ReactNode } from "react";

type ButtonLinkProps = {
  href: ComponentProps<typeof Link>["href"];
  variant?: "secondary" | "ghost";
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;

/**
 * A navigation destination wearing button chrome — `Button`'s secondary/ghost
 * recipes on a real `next/link` anchor, so middle-click and open-in-new-tab
 * work. Extracted after the same class string appeared hand-rolled in the
 * collection layout and the diagnostics action links.
 *
 * Deliberately no primary/glow variant: the page's glowing primary action is
 * a `Button` doing something, not a link going somewhere.
 */
export function ButtonLink({
  href,
  variant = "secondary",
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 rounded-control px-2 py-1 text-ui transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        {
          secondary:
            "border border-hairline bg-surface text-body hover:border-strong hover:text-primary",
          ghost: "text-muted hover:bg-surface hover:text-primary",
        }[variant],
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
