"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { GlassCard } from "@/components/ui/panel";

import type { BuiltinDatasetInfo } from "@/lib/types";

interface ImportBenchmarkDialogProps {
  open: boolean;
  benchmarks: BuiltinDatasetInfo[];
  importedKeys: Set<string>;
  onImport: (key: string) => Promise<boolean>;
  onClose: () => void;
}

export function ImportBenchmarkDialog({
  open,
  benchmarks,
  importedKeys,
  onImport,
  onClose,
}: ImportBenchmarkDialogProps) {
  const titleId = useId();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const handleImport = async (key: string) => {
    setBusyKey(key);
    const ok = await onImport(key);
    setBusyKey(null);
    if (ok) onClose();
  };

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <GlassCard className="w-full max-w-2xl rounded-3xl border border-hairline bg-canvas-raised/95 p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Benchmarks</p>
        <h2 id={titleId} className="mt-2 text-xl font-semibold text-primary">
          Import a vetted benchmark
        </h2>
        <p className="mt-1 text-sm text-muted">
          The corpus, queries, and relevance judgments download in the background.
        </p>
        <ul className="mt-5 space-y-3">
          {benchmarks.map((benchmark) => {
            const imported = importedKeys.has(benchmark.key);
            return (
              <li
                key={benchmark.key}
                className="flex items-center justify-between gap-4 rounded-2xl border border-hairline bg-surface p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="font-medium text-primary">{benchmark.name}</p>
                    <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent-cyan">
                      {benchmark.domain}
                    </p>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-body">{benchmark.measures}</p>
                  <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                    {benchmark.num_queries.toLocaleString()} queries ·{" "}
                    {benchmark.num_corpus_docs.toLocaleString()} docs
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0 px-5"
                  disabled={imported || busyKey !== null}
                  loading={busyKey === benchmark.key}
                  onClick={() => handleImport(benchmark.key)}
                >
                  {imported ? "Imported" : "Import"}
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={onClose} className="px-5">
            Close
          </Button>
        </div>
      </GlassCard>
    </ModalOverlay>
  );
}
