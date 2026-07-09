import Link from "next/link";

import { CONSOLE_HREF, GITHUB_URL, LICENSE_LABEL } from "@/components/landing/lib/constants";

/** Quiet footer: the three links that matter for an OSS project. */
export function LandingFooter() {
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.28em] text-meta">
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="transition hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
      >
        GitHub
      </a>
      <span className="text-faint" aria-hidden>
        ·
      </span>
      <Link
        href={CONSOLE_HREF}
        className="transition hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
      >
        Console
      </Link>
      <span className="text-faint" aria-hidden>
        ·
      </span>
      <span>{LICENSE_LABEL}</span>
    </footer>
  );
}
