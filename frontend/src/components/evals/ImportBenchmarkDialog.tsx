"use client";

import { useId, useState } from "react";

import { badgedModalities, MODALITY_LABEL } from "@/components/evals/lib/modalities";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ModalOverlay } from "@/components/ui/modal-overlay";

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
      <div className="card-surface flex max-h-[80vh] w-full max-w-2xl flex-col bg-canvas-raised shadow-elevation-2">
        <div className="shrink-0 border-b border-hairline px-4 py-3">
          <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
            Import a vetted benchmark
          </h2>
          <p className="mt-1 max-w-[66ch] text-ui text-muted">
            The corpus, queries, and relevance judgments download in the background.
          </p>
        </div>

        {/* Rows inside the dialog card, not a card per benchmark: page → card →
            row is the container ceiling. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {benchmarks.map((benchmark) => {
            const imported = importedKeys.has(benchmark.key);
            return (
              <div
                key={benchmark.key}
                className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-ui font-medium text-primary">{benchmark.name}</p>
                    {/* The subject area — a fact with no state. */}
                    <Chip tone="neutral" dot={false}>
                      {benchmark.domain}
                    </Chip>
                    {/* Text is every benchmark's baseline, so only the corpora
                        that carry something else are marked. */}
                    {badgedModalities(benchmark.modalities).map((modality) => (
                      <Chip key={modality} tone="neutral" dot={false}>
                        {MODALITY_LABEL[modality]}
                      </Chip>
                    ))}
                  </div>
                  <p className="mt-1 max-w-[66ch] text-ui text-body">{benchmark.measures}</p>
                  {/* Counts, download size, and licence together: the size is
                      what an import costs and the licence is what it obliges,
                      and both have to be read before Import is clicked. */}
                  <p className="mt-1 font-mono text-instrument tabular-nums text-muted">
                    {benchmark.num_queries.toLocaleString()} queries ·{" "}
                    {benchmark.num_corpus_docs.toLocaleString()} docs ·{" "}
                    {benchmark.approx_download_mb.toLocaleString()} MB download ·{" "}
                    {benchmark.license_name}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  disabled={imported || busyKey !== null}
                  loading={busyKey === benchmark.key}
                  onClick={() => handleImport(benchmark.key)}
                >
                  {imported ? "Imported" : "Import"}
                </Button>
              </div>
            );
          })}
          {benchmarks.length === 0 && (
            <p className="p-8 text-center text-ui text-muted">No benchmarks available.</p>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-hairline px-4 py-3">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
