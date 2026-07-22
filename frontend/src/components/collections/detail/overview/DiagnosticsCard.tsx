"use client";

import Link from "next/link";

import { useCollectionDiagnostics } from "@/components/collections/detail/diagnostics/use-collection-diagnostics";
import { GlassCard } from "@/components/ui/panel";
import { CONSISTENT_STYLE, severityStyle } from "@/lib/diagnostics-severity";
import { cn } from "@/lib/utils";

interface DiagnosticsCardProps {
  collectionId: string;
  token: string;
}

/**
 * Compact Overview status widget. Summarizes error/warning counts and a
 * consistency pill; the detailed findings live on the Diagnostics tab.
 *
 * The pill reads "Configuration consistent" deliberately: `consistent` ignores
 * `run_failures` and `node_config`, so it claims the current *configuration* is
 * sound, not that nothing at all is worth noting.
 */
function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function DiagnosticsCard({ collectionId, token }: DiagnosticsCardProps) {
  const { data, loading, error } = useCollectionDiagnostics(token, collectionId);

  if (error || (!data && !loading)) {
    return null; // never block the Overview on the diagnostics service
  }

  const errorCount = data?.error_count ?? 0;
  const warningCount = data?.warning_count ?? 0;
  const consistent = data?.consistent ?? true;
  const pill = consistent ? CONSISTENT_STYLE : severityStyle(errorCount > 0 ? "error" : "warning");
  const PillIcon = pill.icon;
  const detail =
    loading && !data
      ? "Checking…"
      : `${pluralize(errorCount, "error")}, ${pluralize(warningCount, "warning")}`;

  return (
    <GlassCard className="rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Diagnostics</p>
        <Link
          href={`/collections/${collectionId}/diagnostics`}
          className="text-xs text-muted underline-offset-2 transition hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet rounded"
        >
          View diagnostics
        </Link>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full",
            pill.chipClass,
          )}
        >
          <PillIcon className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-primary">
            {consistent ? "Configuration consistent" : "Issues found"}
          </p>
          <p className="text-xs text-muted">{detail}</p>
        </div>
      </div>
    </GlassCard>
  );
}
