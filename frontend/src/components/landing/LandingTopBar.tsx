import { Github } from "lucide-react";
import Link from "next/link";

import { CONSOLE_HREF, GITHUB_URL } from "@/components/landing/lib/constants";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/** Minimal top bar: wordmark on the left, theme + GitHub + console on the right. */
export function LandingTopBar() {
  return (
    <header className="flex items-center justify-between">
      <span className="flex items-center gap-2 font-mono text-sm font-medium uppercase tracking-[0.32em] text-primary">
        <span
          className="h-2 w-2 rounded-full bg-gradient-to-r from-accent-violet to-accent-cyan"
          aria-hidden
        />
        Ragworks
      </span>
      <nav className="flex items-center gap-1 sm:gap-2">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-full px-3 py-2 text-sm text-body transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          <Github className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">GitHub</span>
        </a>
        <Link
          href={CONSOLE_HREF}
          className="rounded-full border border-hairline bg-surface px-4 py-2 text-sm text-primary transition hover:border-strong hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          Console
        </Link>
        <ThemeToggle />
      </nav>
    </header>
  );
}
