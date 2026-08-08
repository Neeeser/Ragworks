"use client";

import { DiagnosticItem } from "@/components/collections/detail/diagnostics/DiagnosticItem";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import type { CollectionDiagnostic } from "@/lib/types";

/**
 * Findings for the pipeline pairing the wizard currently has selected.
 *
 * The same rules and the same finding rendering the Diagnostics tab uses, so
 * a pairing reads identically before and after the collection exists. Nothing
 * here blocks Create: creating a collection and fixing its pipelines later is
 * a legitimate way to work.
 */
export function WizardDiagnostics({ diagnostics }: { diagnostics: CollectionDiagnostic[] }) {
  if (diagnostics.length === 0) {
    return null;
  }
  return (
    <div className="rounded-panel border border-hairline bg-surface">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-3 py-2">
        <InstrumentLabel>Diagnostics</InstrumentLabel>
        <p className="text-instrument text-muted">These do not block creating the collection.</p>
      </div>
      {diagnostics.map((diagnostic, index) => (
        <DiagnosticItem key={`${diagnostic.code}-${index}`} diagnostic={diagnostic} compact />
      ))}
    </div>
  );
}
