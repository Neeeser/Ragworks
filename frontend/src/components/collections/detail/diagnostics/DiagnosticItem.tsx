"use client";

import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { severityStyle } from "@/lib/diagnostics-severity";
import { cn } from "@/lib/utils";

import type { CollectionDiagnostic, DiagnosticObservation } from "@/lib/types";

const CONFIDENCE_LABEL: Record<CollectionDiagnostic["confidence"], string> = {
  confirmed: "Confirmed",
  heuristic: "Possible",
};

function ObservationRow({ observation }: { observation: DiagnosticObservation }) {
  const paired = observation.ingestion != null || observation.retrieval != null;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-1.5 text-sm">
      <span className="text-muted">{observation.label}</span>
      {paired ? (
        <span className="flex items-center gap-2 font-mono text-xs">
          <span className="rounded bg-surface px-1.5 py-0.5 text-body">
            ingest: {observation.ingestion ?? "—"}
          </span>
          <span className="rounded bg-surface px-1.5 py-0.5 text-body">
            query: {observation.retrieval ?? "—"}
          </span>
        </span>
      ) : (
        <span className="font-mono text-xs text-body">{observation.value ?? "—"}</span>
      )}
    </div>
  );
}

/** One diagnostic finding: severity, title/summary, observations, action, links. */
export function DiagnosticItem({ diagnostic }: { diagnostic: CollectionDiagnostic }) {
  const router = useRouter();
  const style = severityStyle(diagnostic.severity);
  const Icon = style.icon;

  return (
    <div className={cn("rounded-2xl border p-4", style.boxClass)}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            style.chipClass,
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-primary">{diagnostic.title}</h3>
            <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
              {CONFIDENCE_LABEL[diagnostic.confidence]}
            </span>
          </div>
          <p className="mt-1 text-sm text-body">{diagnostic.summary}</p>

          {diagnostic.observations.length > 0 && (
            <div className="mt-3 divide-y divide-hairline rounded-xl border border-hairline bg-surface/40 px-3">
              {diagnostic.observations.map((observation, index) => (
                <ObservationRow key={`${observation.label}-${index}`} observation={observation} />
              ))}
            </div>
          )}

          {(diagnostic.action || diagnostic.links.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {diagnostic.action && (
                <button
                  type="button"
                  onClick={() => router.push(diagnostic.action!.route)}
                  className="inline-flex items-center gap-1 rounded-lg border border-strong bg-surface px-3 py-1.5 text-xs font-medium text-primary transition hover:border-accent-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                >
                  {diagnostic.action.label}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
              {diagnostic.links.map((link) => (
                <button
                  key={link.route}
                  type="button"
                  onClick={() => router.push(link.route)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted underline-offset-2 transition hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                >
                  {link.label}
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
