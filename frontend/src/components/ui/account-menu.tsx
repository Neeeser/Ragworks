"use client";

import { LogOut, Moon, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { popoverSurfaceClass } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/providers/theme-provider";

import type { User } from "@/lib/types";

/** A stable identity-derived gradient, so an account is recognisable at 24px. */
function useAvatarStyle(seed: string) {
  return useMemo(() => {
    let hash = 0;
    for (let idx = 0; idx < seed.length; idx += 1) {
      hash = (hash * 31 + seed.charCodeAt(idx)) % 360;
    }
    const hueA = hash % 360;
    const hueB = (hash * 3 + 120) % 360;
    return {
      backgroundImage: `linear-gradient(135deg, hsl(${hueA}, 55%, 42%), hsl(${hueB}, 50%, 32%))`,
    };
  }, [seed]);
}

function initials(user: User): string {
  const label = (user.full_name || user.email || "U").trim();
  const parts = label.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }
  return label.slice(0, 1).toUpperCase();
}

/**
 * The rail's account control: a 24px avatar opening the theme switch,
 * settings, and sign-out.
 *
 * The old top nav also printed the user's name and email beside it on every
 * page. In a rail that identity is already implied by being signed in, so the
 * text is dropped and the email moves inside the menu where it is checkable
 * without occupying permanent chrome.
 */
export function AccountMenu({ user }: { user: User }) {
  const { signOut } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const avatarStyle = useAvatarStyle(user.id || user.email || "ragworks");

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold text-white transition-[box-shadow] duration-80 ease-standard",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
          open ? "ring-2 ring-accent-violet" : "hover:ring-1 hover:ring-strong",
        )}
        style={avatarStyle}
      >
        {initials(user)}
      </button>
      {open ? (
        <div
          // Deliberately not role="menu": that role promises arrow-key
          // navigation between menuitems, which this does not implement, and it
          // would also strip the implicit link/button roles from the items.
          className={cn(
            popoverSurfaceClass,
            // Opens to the right of the sidebar avatar at lg+, and upward from
            // the bottom tab bar below lg — where "to the right" of a control
            // at the screen's right edge would land the menu off-screen.
            "absolute z-30 w-48 overflow-hidden py-1",
            "max-lg:bottom-full max-lg:right-0 max-lg:mb-2",
            "lg:bottom-0 lg:left-full lg:ml-2",
          )}
        >
          <Tooltip content={user.email} side="right" triggerClassName="w-full">
            <p className="truncate px-2 py-1 text-ui text-meta">{user.email}</p>
          </Tooltip>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-ui text-body transition-colors duration-80 ease-standard hover:bg-surface"
            // The menu stays open so the flip is visible where it was made.
            onClick={toggleTheme}
          >
            {isDark ? (
              <Sun className="h-3.5 w-3.5 text-muted" aria-hidden />
            ) : (
              <Moon className="h-3.5 w-3.5 text-muted" aria-hidden />
            )}
            {isDark ? "Switch to light theme" : "Switch to dark theme"}
          </button>
          <Link
            href="/settings"
            className="flex items-center gap-2 px-2 py-1.5 text-ui text-body transition-colors duration-80 ease-standard hover:bg-surface"
            onClick={() => setOpen(false)}
          >
            <Settings className="h-3.5 w-3.5 text-muted" aria-hidden />
            Settings
          </Link>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-ui text-body transition-colors duration-80 ease-standard hover:bg-surface"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            <LogOut className="h-3.5 w-3.5 text-muted" aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
