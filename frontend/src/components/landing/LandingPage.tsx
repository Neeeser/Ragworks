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
 *
 * All color comes from design tokens (see globals.css), so the page follows the
 * active theme; the atmospheric blooms mix the accent tokens over the canvas.
 */
export function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-canvas text-body">
      {/* Layer 0: the signature running pipeline. */}
      <HeroFlowBackdrop />

      {/* Layer 1: atmospheric blooms in the product's violet/cyan trace colors. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60% 50% at 18% 12%, color-mix(in srgb, var(--accent-violet) 22%, transparent), transparent 60%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(55% 45% at 85% 10%, color-mix(in srgb, var(--accent-cyan) 16%, transparent), transparent 60%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-canvas to-transparent" />
      </div>

      {/* Layer 2: content. */}
      <div className="relative z-10 flex min-h-screen flex-col px-6 py-8 sm:px-10 sm:py-10">
        <LandingTopBar />

        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          {/* Above the flow band. */}
          <div className="flex flex-col items-center gap-6">
            <p
              className="landing-rise flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.4em] text-muted sm:text-xs"
              style={{ animationDelay: "0ms" }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-cyan opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-cyan" />
              </span>
              Open-source RAG workbench
            </p>

            <h1
              className="landing-rise max-w-4xl text-balance text-5xl font-semibold leading-[1.02] tracking-tight text-primary sm:text-6xl md:text-7xl"
              style={{ animationDelay: "80ms" }}
            >
              Build, run, and{" "}
              <span className="bg-gradient-to-r from-grad-from via-grad-via to-grad-to bg-clip-text text-transparent">
                inspect
              </span>{" "}
              RAG pipelines.
            </h1>
          </div>

          {/* A modest gap for the flow band — the pipeline is ambient scenery,
              not an exhibit, so the actions below are allowed to float over
              its lower edge. */}
          <div className="h-32 w-full sm:h-44" aria-hidden />

          {/* Below the flow band — actions only. The running pipeline says what
              the product does; words don't need to repeat it. */}
          <div
            className="landing-rise flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: "160ms" }}
          >
            <Link
              href={CONSOLE_HREF}
              className="group flex items-center gap-2 rounded-full bg-accent-violet px-6 py-3 text-base font-semibold text-white shadow-glow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
              className="flex items-center gap-2 rounded-full border border-hairline bg-surface px-6 py-3 text-base font-medium text-primary transition hover:border-strong hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
