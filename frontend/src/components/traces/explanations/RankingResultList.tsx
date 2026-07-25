"use client";

import { ArrowRight, FileText, LocateFixed } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatTracePreview } from "@/components/traces/explanations/summary-data";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";
import { cn } from "@/lib/utils";

import type { RankingEvidence, RankingSourceEvidence, TraceFocusedItem } from "@/lib/types";

type RankingResultListProps = {
  title: string;
  evidence: RankingEvidence;
  focusedItemId: string | null;
  contextItems: TraceFocusedItem[];
  previews?: ReadonlyMap<string, string>;
  sourceLabels: string[];
  sourceScoreLabels?: Array<string | null>;
  onFocusItem?: (itemId: string) => void;
  onOpenArtifact?: (item: TraceFocusedItem) => void;
};

const scoreText = (score: number): string =>
  Math.abs(score) >= 10 ? score.toFixed(3) : score.toFixed(4);

const resultTitle = (item: TraceFocusedItem | undefined, rank: number): string => {
  if (!item) return `Result ${rank}`;
  const chunk =
    item.chunk_index === null || item.chunk_index === undefined
      ? null
      : `Chunk ${item.chunk_index + 1}`;
  return [item.filename, chunk].filter(Boolean).join(" · ") || `Result ${rank}`;
};

const contributionShares = (sources: RankingSourceEvidence[]): number[] => {
  const total = sources.reduce((sum, source) => sum + Math.abs(source.contribution ?? 0), 0);
  return sources.map((source) => (total ? (Math.abs(source.contribution ?? 0) / total) * 100 : 0));
};

type ContributionRowProps = {
  source: RankingSourceEvidence;
  label: string;
  scoreLabel: string;
  share: number;
  signed: boolean;
  index: number;
};

function ContributionRow({
  source,
  label,
  scoreLabel,
  share,
  signed,
  index,
}: ContributionRowProps) {
  const negative = (source.contribution ?? 0) < 0;
  const barWidth = signed ? share / 2 : share;
  // Contribution bars are chart marks, so they read chart series tokens.
  const barTone = index % 2 === 0 ? "bg-series-1" : "bg-series-2";
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.7fr)_minmax(10rem,1fr)] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-ui font-medium text-primary">{label}</span>
          {source.rank !== null && source.rank !== undefined ? (
            <span className="font-mono text-instrument tabular-nums text-meta">#{source.rank}</span>
          ) : null}
        </div>
        {source.score !== null && source.score !== undefined ? (
          <p className="mt-0.5 font-mono text-instrument tabular-nums text-muted">
            {source.score_label ?? scoreLabel} · {scoreText(source.score)}
            {source.weight !== null && source.weight !== undefined
              ? ` · weight ${scoreText(source.weight)}`
              : ""}
          </p>
        ) : null}
      </div>
      {source.contribution !== null && source.contribution !== undefined ? (
        <div>
          <div
            role="progressbar"
            aria-label={`${label} contribution`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share)}
            aria-valuetext={`${negative ? "negative " : ""}${scoreText(source.contribution)} (${Math.round(share)} percent of absolute contribution)`}
            className={cn(
              "relative h-2 overflow-hidden rounded-full bg-surface-strong",
              signed &&
                "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-strong",
            )}
          >
            <span
              className={cn("absolute inset-y-0 rounded-full", barTone)}
              style={
                signed
                  ? negative
                    ? { right: "50%", width: `${barWidth}%` }
                    : { left: "50%", width: `${barWidth}%` }
                  : { left: 0, width: `${barWidth}%` }
              }
            />
          </div>
          <p className="mt-1 text-right font-mono text-instrument tabular-nums text-meta">
            {source.contribution > 0 ? "+" : ""}
            {scoreText(source.contribution)}
          </p>
        </div>
      ) : (
        <p className="text-instrument text-meta">Contribution not recorded</p>
      )}
    </div>
  );
}

/** Unified ranked results with expandable, method-neutral source evidence. */
export function RankingResultList({
  title,
  evidence,
  focusedItemId,
  contextItems,
  previews = new Map(),
  sourceLabels,
  sourceScoreLabels = [],
  onFocusItem,
  onOpenArtifact,
}: RankingResultListProps) {
  const [inspectedId, setInspectedId] = useState<string | null>(() =>
    focusedItemId && evidence.results.some((result) => result.id === focusedItemId)
      ? focusedItemId
      : null,
  );
  const focusedRef = useRef<HTMLLIElement | null>(null);
  const contextById = useMemo(
    () => new Map(contextItems.map((item) => [item.id, item])),
    [contextItems],
  );

  useEffect(() => {
    focusedRef.current?.scrollIntoView?.({ block: "center", behavior: "auto" });
  }, [focusedItemId]);

  return (
    <section className="min-w-0 rounded-panel border border-hairline bg-surface p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-ui font-medium text-primary">{title}</h3>
        <Readout label="Results">{evidence.results.length}</Readout>
        {evidence.formula ? (
          <span className="ml-auto font-mono text-instrument tabular-nums text-meta">
            {evidence.formula}
          </span>
        ) : null}
      </div>
      <ol aria-label={title} className="mt-2 space-y-2">
        {evidence.results.map((result) => {
          const context = contextById.get(result.id);
          const preview = context?.text ?? previews.get(result.id);
          const selected = result.id === inspectedId;
          const title = resultTitle(context, result.rank);
          const shares = contributionShares(result.sources);
          const signed = result.sources.some((source) => (source.contribution ?? 0) < 0);
          return (
            <li
              key={result.id}
              ref={result.id === focusedItemId ? focusedRef : undefined}
              aria-current={result.id === focusedItemId ? "true" : undefined}
              className={cn(
                "relative overflow-hidden rounded-panel border bg-canvas",
                result.id === focusedItemId
                  ? "border-accent-cyan/60"
                  : selected
                    ? "border-strong"
                    : "border-hairline",
              )}
            >
              <button
                type="button"
                aria-label={`Inspect result ${result.id}`}
                aria-expanded={selected}
                onClick={() => setInspectedId(selected ? null : result.id)}
                className="grid w-full grid-cols-[3.25rem_1fr] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-violet"
              >
                <span className="flex flex-col items-center justify-center border-r border-hairline bg-surface px-2 py-3">
                  <InstrumentLabel className="text-meta">Rank</InstrumentLabel>
                  <span className="mt-1 font-mono text-[20px] tabular-nums text-primary">
                    {result.rank}
                  </span>
                </span>
                <span className="min-w-0 px-3 py-2">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate pr-24 text-ui font-medium text-primary">
                      {title}
                    </span>
                    {result.score !== null && result.score !== undefined ? (
                      <span className="font-mono text-instrument tabular-nums text-accent-cyan">
                        {scoreText(result.score)}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block line-clamp-2 text-ui leading-relaxed text-body">
                    {preview
                      ? formatTracePreview(preview)
                      : "Text preview was not recorded for this result."}
                  </span>
                  {result.sources.length ? (
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      {result.sources.map((source) => (
                        <Chip key={source.source_index} tone="retrieve" dot={false}>
                          {sourceLabels[source.source_index] ?? `Source ${source.source_index + 1}`}
                          {source.rank ? ` #${source.rank}` : ""}
                        </Chip>
                      ))}
                      <ArrowRight className="h-3 w-3 text-meta" aria-hidden />
                      <Chip tone="accent" dot={false}>{`Fused #${result.rank}`}</Chip>
                    </span>
                  ) : null}
                </span>
              </button>
              {onFocusItem && result.id !== focusedItemId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Trace result ${title}`}
                  onClick={() => {
                    setInspectedId(result.id);
                    onFocusItem(result.id);
                  }}
                  className="absolute right-1 top-1 text-instrument"
                >
                  <LocateFixed className="h-3 w-3" aria-hidden />
                  Trace result
                </Button>
              ) : null}
              {selected ? (
                <div className="border-t border-hairline bg-surface px-3 py-3 sm:pl-[4.25rem]">
                  <div className="space-y-3">
                    {result.sources.map((source, index) => (
                      <ContributionRow
                        key={source.source_index}
                        source={source}
                        label={
                          sourceLabels[source.source_index] ?? `Source ${source.source_index + 1}`
                        }
                        scoreLabel={sourceScoreLabels[source.source_index] ?? "Source score"}
                        share={shares[index] ?? 0}
                        signed={signed}
                        index={index}
                      />
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-1 border-t border-hairline pt-3">
                    {context && onOpenArtifact ? (
                      <Button variant="secondary" size="sm" onClick={() => onOpenArtifact(context)}>
                        <FileText className="h-3.5 w-3.5" aria-hidden />
                        Open chunk
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
