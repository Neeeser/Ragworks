import { ArrowRight, Github } from "lucide-react";
import Link from "next/link";

import { HeroFlowBackdrop } from "@/components/landing/HeroFlowBackdrop";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingTopBar } from "@/components/landing/LandingTopBar";
import { CONSOLE_HREF, GITHUB_URL } from "@/components/landing/lib/constants";

/**
 * The public landing page. Its thesis is the product itself: a synthetic RAG
 * pipeline runs continuously behind the hero (the `HeroFlowBackdrop`), showing
 * a document flow the same way the trace viewer renders a real one. Everything
 * else stays quiet so the running pipeline is the thing you remember. No
 * marketing copy — this is an open-source tool advertising what it does.
 */
export function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#05060a] text-slate-100">
      {/* Layer 0: the signature running pipeline. */}
      <HeroFlowBackdrop />

      {/* Layer 1: atmospheric blooms in the product's violet/cyan trace colors. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_18%_12%,rgba(139,92,246,0.22),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(55%_45%_at_85%_10%,rgba(34,211,238,0.16),transparent_60%)]" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#05060a] to-transparent" />
      </div>

      {/* Layer 2: content. */}
      <div className="relative z-10 flex min-h-screen flex-col px-6 py-8 sm:px-10 sm:py-10">
        <LandingTopBar />

        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          {/* Above the flow band. */}
          <div className="flex flex-col items-center gap-6">
            <p
              className="landing-rise flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.4em] text-slate-400 sm:text-xs"
              style={{ animationDelay: "0ms" }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-300" />
              </span>
              Open-source RAG workbench
            </p>

            <h1
              className="landing-rise max-w-4xl text-balance text-5xl font-semibold leading-[1.02] tracking-tight text-white sm:text-6xl md:text-7xl"
              style={{ animationDelay: "80ms" }}
            >
              Every RAG signal,{" "}
              <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-300 bg-clip-text text-transparent">
                surfaced.
              </span>
            </h1>
          </div>

          {/* The clear band the running pipeline flows through. */}
          <div className="h-24 w-full sm:h-32" aria-hidden />

          {/* Below the flow band — actions only. The running pipeline says what
              the product does; words don't need to repeat it. */}
          <div
            className="landing-rise flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: "160ms" }}
          >
            <Link
              href={CONSOLE_HREF}
              className="group flex items-center gap-2 rounded-full bg-violet-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05060a]"
            >
              Launch console
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-6 py-3 text-base font-medium text-white transition hover:border-white/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05060a]"
            >
              <Github className="h-4 w-4" aria-hidden />
              View source
            </a>
          </div>
        </section>

        <LandingFooter />
      </div>
    </main>
  );
}
