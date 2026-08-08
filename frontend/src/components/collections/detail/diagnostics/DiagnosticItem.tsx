"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button-link";
import { Chip } from "@/components/ui/chip";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { severityStyle, severityTone } from "@/lib/diagnostics-severity";

import type { CollectionDiagnostic, DiagnosticObservation } from "@/lib/types";

const CONFIDENCE_LABEL: Record<CollectionDiagnostic["confidence"], string> = {
  confirmed: "Confirmed",
  heuristic: "Possible",
};

/**
 * One observed value, or the ingest/query pair a compatibility rule compares.
 *
 * The pair sits inside one value with muted side tags rather than in two boxed
 * cells: the two numbers only mean anything next to each other, and a bordered
 * grid here would be a fourth container level for six characters of data.
 */
function ObservationValue({ observation }: { observation: DiagnosticObservation }) {
  const paired = observation.ingestion != null || observation.retrieval != null;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <InstrumentLabel>{observation.label}</InstrumentLabel>
      {paired ? (
        <span className="flex min-w-0 items-baseline gap-1.5 font-mono text-ui tabular-nums text-primary">
          <span className="text-instrument text-meta">ingest</span>
          <span className="truncate">{observation.ingestion ?? "—"}</span>
          <span className="text-instrument text-meta">query</span>
          <span className="truncate">{observation.retrieval ?? "—"}</span>
        </span>
      ) : (
        <span className="truncate font-mono text-ui tabular-nums text-primary">
          {observation.value ?? "—"}
        </span>
      )}
    </span>
  );
}

/**
 * One diagnostic finding: severity, title/summary, observations, action, links.
 *
 * `compact` drops the action and links. The routes they point at are pipeline
 * editors, so following one from inside a modal (the create wizard) would
 * discard the configuration the finding is about.
 */
export function DiagnosticItem({
  diagnostic,
  compact = false,
}: {
  diagnostic: CollectionDiagnostic;
  compact?: boolean;
}) {
  return (
    <div className="border-b border-hairline p-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Chip tone={severityTone(diagnostic.severity)} dot>
          {severityStyle(diagnostic.severity).label}
        </Chip>
        <h3 className="min-w-0 flex-1 truncate text-ui font-medium text-primary">
          {diagnostic.title}
        </h3>
        <InstrumentLabel>{CONFIDENCE_LABEL[diagnostic.confidence]}</InstrumentLabel>
        {/* The rule's stable code, verbatim: it is what a user quotes in an
            issue and what the docs index findings by. */}
        <span className="font-mono text-instrument text-meta">{diagnostic.code}</span>
      </div>

      <p className="mt-1 max-w-[66ch] text-ui text-body">{diagnostic.summary}</p>

      {diagnostic.observations.length > 0 && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {diagnostic.observations.map((observation, index) => (
            <ObservationValue key={`${observation.label}-${index}`} observation={observation} />
          ))}
        </div>
      )}

      {!compact && (diagnostic.action || diagnostic.links.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {diagnostic.action && (
            <ButtonLink href={diagnostic.action.route}>
              {diagnostic.action.label}
              <ArrowUpRight className="h-3.5 w-3.5 text-muted" aria-hidden />
            </ButtonLink>
          )}
          {diagnostic.links.map((link) => (
            <Link
              key={link.route}
              href={link.route}
              className="inline-flex items-center gap-1 rounded-control px-1 py-1 text-instrument font-medium text-muted transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              {link.label}
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
