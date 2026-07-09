"use client";

import { useState } from "react";

import { buildPreviewPayload } from "@/components/traces/trace-payload-utils";
import { cn, prettyJson, truncate } from "@/lib/utils";

import type {
  ChunkBatchShape,
  EmbeddingPreviewShape,
  EmbeddingSummaryShape,
  MatchListShape,
  MatchOrderEntryShape,
  SourceShape,
  TextSummaryShape,
} from "@/components/traces/values/shape-guards";

export type TraceValueViewProps = {
  value: unknown;
  kind: string;
  highlightChunkId?: string | null;
};

const chipClass =
  "rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-slate-300";
const monoClass = "font-mono text-[10px] text-slate-400";

function Chip({ children }: { children: React.ReactNode }) {
  return <span className={chipClass}>{children}</span>;
}

function ScrollBox({ children }: { children: React.ReactNode }) {
  // Every value view caps its own height and scrolls internally, so a large
  // value never reflows the surrounding panel.
  return <div className="max-h-52 space-y-2 overflow-y-auto pr-1">{children}</div>;
}

/** Prose text with a length chip and expand-to-full toggle. */
export function TextValue({ value }: TraceValueViewProps) {
  const [expanded, setExpanded] = useState(false);
  const summary =
    typeof value === "string"
      ? { preview: truncate(value, 240), length: value.length, full: value }
      : (value as TextSummaryShape);
  const full = summary.full;
  const canExpand = Boolean(full && full.length > summary.preview.length);
  return (
    <div className="space-y-2">
      <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-slate-100">
        {expanded && full ? full : summary.preview}
      </p>
      <div className="flex items-center gap-2">
        <Chip>{summary.length.toLocaleString()} chars</Chip>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-[10px] uppercase tracking-[0.25em] text-cyan-200 hover:text-cyan-100"
          >
            {expanded ? "Show less" : "Show full"}
          </button>
        )}
      </div>
    </div>
  );
}

/** A document source: id, path, content type as labelled fields. */
export function SourceValue({ value }: TraceValueViewProps) {
  const source = value as SourceShape;
  const rows: Array<[string, string]> = [
    ["Document", source.document_id],
    ["Path", source.path],
    ["Type", source.content_type ?? "—"],
  ];
  return (
    <dl className="space-y-1.5">
      {rows.map(([label, val]) => (
        <div key={label} className="flex items-baseline gap-3">
          <dt className="w-20 shrink-0 text-[10px] uppercase tracking-[0.25em] text-slate-500">
            {label}
          </dt>
          <dd className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-200" title={val}>
            {val}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A batch of chunks: a count (+ document) header and per-chunk preview cards. */
export function ChunkListValue({ value, highlightChunkId }: TraceValueViewProps) {
  const batch = value as ChunkBatchShape;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Chip>{batch.count} chunks</Chip>
        {batch.document_id ? <Chip>doc {truncate(batch.document_id, 12)}</Chip> : null}
      </div>
      <ScrollBox>
        {batch.samples.map((sample) => {
          const active = highlightChunkId ? sample.chunk_id === highlightChunkId : false;
          return (
            <div
              key={sample.chunk_id}
              className={cn(
                "rounded-xl border border-white/10 bg-black/30 p-2.5",
                active && "border-cyan-400/70 bg-cyan-500/10",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={monoClass}>{sample.chunk_id}</span>
                <span className={chipClass}>#{sample.order}</span>
              </div>
              <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-slate-200">
                {sample.preview}
              </p>
            </div>
          );
        })}
        {batch.samples.length === 0 && <p className="text-xs text-slate-500">No chunk samples.</p>}
      </ScrollBox>
    </div>
  );
}

/** A fixed-length vector preview drawn as a compact bar sparkline. */
function VectorSparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const max = Math.max(...values.map(Math.abs), 1e-9);
  return (
    <div className="flex h-10 items-end gap-px" aria-hidden>
      {values.slice(0, 40).map((val, index) => {
        const height = Math.max(4, (Math.abs(val) / max) * 100);
        return (
          <span
            key={index}
            className={cn(
              "min-w-0 flex-1 rounded-[1px]",
              val >= 0 ? "bg-cyan-400/80" : "bg-amber-400/70",
            )}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

/** Embedding vectors: dimension/count chips + a sparkline + numeric preview. */
export function EmbeddingValue({ value }: TraceValueViewProps) {
  const asPreview = value as Partial<EmbeddingPreviewShape>;
  const asSummary = value as Partial<EmbeddingSummaryShape>;
  const previews: EmbeddingPreviewShape[] = Array.isArray(asPreview.preview)
    ? [{ preview: asPreview.preview, total_values: asPreview.total_values ?? 0 }]
    : (asSummary.samples ?? [])
        .map((sample) => sample.preview)
        .filter((preview): preview is EmbeddingPreviewShape => Boolean(preview));
  const dimension =
    asSummary.dimension ??
    (typeof asPreview.total_values === "number" ? asPreview.total_values : undefined) ??
    previews[0]?.total_values;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {typeof dimension === "number" && dimension > 0 ? <Chip>{dimension}-dim</Chip> : null}
        {typeof asSummary.count === "number" ? <Chip>{asSummary.count} vectors</Chip> : null}
      </div>
      {previews.length ? (
        <div className="space-y-2">
          {previews.slice(0, 2).map((preview, index) => (
            <div key={index} className="rounded-xl border border-white/10 bg-black/30 p-2.5">
              <VectorSparkline values={preview.preview} />
              <p className="mt-1.5 truncate font-mono text-[10px] text-slate-500">
                [{preview.preview.map((v) => v.toFixed(3)).join(", ")}
                {preview.total_values > preview.preview.length ? ", …" : ""}]
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No embedding recorded.</p>
      )}
    </div>
  );
}

/** Retrieval matches: ranked rows with score bars and previews. */
export function MatchListValue({ value, highlightChunkId }: TraceValueViewProps) {
  const list = value as MatchListShape;
  const maxScore = Math.max(...list.top_matches.map((match) => match.score), 1e-9);
  return (
    <div className="space-y-2">
      <Chip>{list.count} matches</Chip>
      <ScrollBox>
        {list.top_matches.map((match) => {
          const active = highlightChunkId ? match.chunk_id === highlightChunkId : false;
          return (
            <div
              key={match.chunk_id}
              className={cn(
                "rounded-xl border border-white/10 bg-black/30 p-2.5",
                active && "border-cyan-400/70 bg-cyan-500/10",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold leading-none text-slate-200">
                  {match.rank}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                    style={{ width: `${(match.score / maxScore) * 100}%` }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[11px] text-slate-200">
                  {match.score.toFixed(3)}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-slate-200">
                {match.preview}
              </p>
              <p className={cn("mt-1 truncate", monoClass)}>{match.chunk_id}</p>
            </div>
          );
        })}
      </ScrollBox>
    </div>
  );
}

/** Reranker before/after ordering: compact rank·score chips. */
export function MatchOrderValue({ value }: TraceValueViewProps) {
  const entries = value as MatchOrderEntryShape[];
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((entry) => (
        <span
          key={`${entry.rank}-${entry.chunk_id}`}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2 py-1"
          title={entry.chunk_id}
        >
          <span className="text-[10px] font-semibold text-slate-300">#{entry.rank}</span>
          <span className="font-mono text-[10px] text-cyan-200">{entry.score.toFixed(3)}</span>
        </span>
      ))}
    </div>
  );
}

/** A small flat object rendered as labelled fields (e.g. reranker settings). */
export function KeyValueView({ value }: TraceValueViewProps) {
  const record = value as Record<string, string | number | boolean | null>;
  return (
    <dl className="grid grid-cols-2 gap-2">
      {Object.entries(record).map(([label, val]) => (
        <div key={label} className="rounded-xl border border-white/10 bg-black/30 px-2.5 py-1.5">
          <dt className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
            {label.replace(/_/g, " ")}
          </dt>
          <dd className="mt-0.5 truncate text-[12px] text-slate-100">{String(val)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A single scalar shown prominently (e.g. Top K). */
export function ScalarValue({ value }: TraceValueViewProps) {
  return <p className="text-lg font-semibold text-white">{value === null ? "—" : String(value)}</p>;
}

/** Fallback: normalized, array-collapsed JSON with an expand toggle. */
export function JsonValue({ value }: TraceValueViewProps) {
  const [expanded, setExpanded] = useState(false);
  const text = expanded ? prettyJson(value) : prettyJson(buildPreviewPayload(value));
  return (
    <div className="space-y-2">
      <pre className="max-h-52 overflow-auto rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
        {text}
      </pre>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="text-[10px] uppercase tracking-[0.25em] text-cyan-200 hover:text-cyan-100"
      >
        {expanded ? "Collapse" : "Expand"}
      </button>
    </div>
  );
}
