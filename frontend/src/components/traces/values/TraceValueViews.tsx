"use client";

import { useEffect, useRef, useState } from "react";

import { buildPreviewPayload } from "@/components/traces/trace-payload-utils";
import { InspectableTraceItem } from "@/components/traces/values/InspectableTraceItem";
import { TraceItemRow } from "@/components/traces/values/TraceItemRow";
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
import type { ItemListTrace } from "@/lib/types";

export type TraceValueViewProps = {
  value: unknown;
  kind: string;
  focusedItemId?: string | null;
  onFocusItem?: (itemId: string) => void;
  onOpenItem?: (itemId: string) => void;
};

const chipClass =
  "rounded-full border border-hairline bg-surface px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-muted";
const monoClass = "font-mono text-[10px] text-muted";

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
      <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-body">
        {expanded && full ? full : summary.preview}
      </p>
      <div className="flex items-center gap-2">
        <Chip>{summary.length.toLocaleString()} chars</Chip>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-[10px] uppercase tracking-[0.25em] text-accent-cyan transition hover:brightness-110"
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
          <dt className="w-20 shrink-0 text-[10px] uppercase tracking-[0.25em] text-meta">
            {label}
          </dt>
          <dd className="min-w-0 flex-1 truncate font-mono text-[11px] text-body" title={val}>
            {val}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A batch of chunks: a count (+ document) header and per-chunk preview cards. */
export function ChunkListValue({
  value,
  focusedItemId,
  onFocusItem,
  onOpenItem,
}: TraceValueViewProps) {
  const batch = value as ChunkBatchShape;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Chip>{batch.count} chunks</Chip>
        {batch.document_id ? <Chip>doc {truncate(batch.document_id, 12)}</Chip> : null}
      </div>
      <ScrollBox>
        {batch.samples.map((sample) => {
          const active = focusedItemId ? sample.chunk_id === focusedItemId : false;
          return (
            <InspectableTraceItem
              key={sample.chunk_id}
              itemId={sample.chunk_id}
              focused={active}
              onFocusItem={onFocusItem}
              onOpenItem={onOpenItem}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={monoClass}>{sample.chunk_id}</span>
                <span className={chipClass}>#{sample.order}</span>
              </div>
              <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-body">
                {sample.preview}
              </p>
            </InspectableTraceItem>
          );
        })}
        {batch.samples.length === 0 && <p className="text-xs text-meta">No chunk samples.</p>}
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
            className={cn("min-w-0 flex-1 rounded-[1px]", val >= 0 ? "bg-data-pos" : "bg-data-neg")}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

/** Embedding vectors: dimension/count chips + a sparkline + numeric preview. */
export function EmbeddingValue({ value, focusedItemId, onFocusItem }: TraceValueViewProps) {
  const asPreview = value as Partial<EmbeddingPreviewShape>;
  const asSummary = value as Partial<EmbeddingSummaryShape>;
  const previews: Array<{ id: string | null; preview: EmbeddingPreviewShape }> = Array.isArray(
    asPreview.preview,
  )
    ? [
        {
          id: null,
          preview: { preview: asPreview.preview, total_values: asPreview.total_values ?? 0 },
        },
      ]
    : (asSummary.samples ?? []).flatMap((sample) =>
        sample.preview ? [{ id: sample.chunk_id, preview: sample.preview }] : [],
      );
  const dimension =
    asSummary.dimension ??
    (typeof asPreview.total_values === "number" ? asPreview.total_values : undefined) ??
    previews[0]?.preview.total_values;
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {typeof dimension === "number" && dimension > 0 ? <Chip>{dimension}-dim</Chip> : null}
        {typeof asSummary.count === "number" ? <Chip>{asSummary.count} vectors</Chip> : null}
      </div>
      {previews.length ? (
        <div className="space-y-2">
          {previews.slice(0, 2).map((sample, index) => (
            <TraceItemRow
              key={sample.id ?? index}
              itemId={sample.id ?? `embedding-${index + 1}`}
              focused={Boolean(sample.id && sample.id === focusedItemId)}
              onFocusItem={sample.id ? onFocusItem : undefined}
              className="w-full rounded-xl border border-hairline bg-canvas p-2.5 text-left"
            >
              <VectorSparkline values={sample.preview.preview} />
              <p className="mt-1.5 truncate font-mono text-[10px] text-meta">
                {sample.id ? `${sample.id} · ` : ""}[
                {sample.preview.preview.map((v) => v.toFixed(3)).join(", ")}
                {sample.preview.total_values > sample.preview.preview.length ? ", …" : ""}]
              </p>
            </TraceItemRow>
          ))}
        </div>
      ) : (
        <p className="text-xs text-meta">No embedding recorded.</p>
      )}
    </div>
  );
}

/** Retrieval matches: ranked rows with score bars and previews. */
export function MatchListValue({
  value,
  focusedItemId,
  onFocusItem,
  onOpenItem,
}: TraceValueViewProps) {
  const list = value as MatchListShape;
  const maxScore = Math.max(...list.top_matches.map((match) => match.score), 1e-9);
  return (
    <div className="space-y-3">
      <Chip>{list.count} matches</Chip>
      <ScrollBox>
        {list.top_matches.map((match) => {
          const active = focusedItemId ? match.chunk_id === focusedItemId : false;
          return (
            <InspectableTraceItem
              key={match.chunk_id}
              itemId={match.chunk_id}
              focused={active}
              onFocusItem={onFocusItem}
              onOpenItem={onOpenItem}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-strong text-[10px] font-semibold leading-none text-body">
                  {match.rank}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent-violet to-accent-cyan"
                    style={{ width: `${(match.score / maxScore) * 100}%` }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[11px] text-body">
                  {match.score.toFixed(3)}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-body">
                {match.preview}
              </p>
              <p className={cn("mt-1 truncate", monoClass)}>{match.chunk_id}</p>
            </InspectableTraceItem>
          );
        })}
      </ScrollBox>
    </div>
  );
}

/** Reranker before/after ordering: compact rank·score chips. */
export function MatchOrderValue({ value, focusedItemId, onFocusItem }: TraceValueViewProps) {
  const entries = value as MatchOrderEntryShape[];
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((entry) => (
        <TraceItemRow
          key={`${entry.rank}-${entry.chunk_id}`}
          itemId={entry.chunk_id}
          focused={entry.chunk_id === focusedItemId}
          onFocusItem={onFocusItem}
          className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2 py-1"
        >
          <span className="text-[10px] font-semibold text-muted">#{entry.rank}</span>
          <span className="font-mono text-[10px] text-accent-cyan">{entry.score.toFixed(3)}</span>
        </TraceItemRow>
      ))}
    </div>
  );
}

/** Complete ordered item ids and scores, centered on the focused row when present. */
export function ItemListValue({ value, focusedItemId, onFocusItem }: TraceValueViewProps) {
  const trace = value as ItemListTrace;
  const ranked = trace.items.map((item, index) => ({ item, rank: index + 1 }));
  const focusedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    focusedRef.current?.scrollIntoView?.({ block: "center", behavior: "auto" });
  }, [focusedItemId]);

  return (
    <div className="space-y-2">
      <Chip>
        {trace.items.length} {trace.kind}
      </Chip>
      <ScrollBox>
        {ranked.map(({ item, rank }) => (
          <div key={item.id} ref={item.id === focusedItemId ? focusedRef : undefined}>
            <TraceItemRow
              itemId={item.id}
              focused={item.id === focusedItemId}
              onFocusItem={onFocusItem}
              className="flex w-full items-center gap-2 rounded-xl border border-hairline bg-canvas px-2.5 py-2 text-left"
            >
              <span className="w-8 shrink-0 font-mono text-[10px] text-muted">#{rank}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-body">
                {item.id}
              </span>
              {typeof item.score === "number" ? (
                <span className="shrink-0 font-mono text-[10px] text-accent-cyan">
                  {item.score.toFixed(3)}
                </span>
              ) : null}
            </TraceItemRow>
          </div>
        ))}
      </ScrollBox>
    </div>
  );
}

/** A small flat object rendered as labelled fields (e.g. reranker settings). */
export function KeyValueView({ value }: TraceValueViewProps) {
  const record = value as Record<string, string | number | boolean | null>;
  return (
    <dl className="grid grid-cols-2 gap-2">
      {Object.entries(record).map(([label, val]) => (
        <div key={label} className="rounded-xl border border-hairline bg-surface px-2.5 py-1.5">
          <dt className="text-[10px] uppercase tracking-[0.25em] text-meta">
            {label.replace(/_/g, " ")}
          </dt>
          <dd className="mt-0.5 truncate text-[12px] text-body">{String(val)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A single scalar shown prominently (e.g. Top K). */
export function ScalarValue({ value }: TraceValueViewProps) {
  return (
    <p className="text-lg font-semibold text-primary">{value === null ? "—" : String(value)}</p>
  );
}

/** Fallback: normalized, array-collapsed JSON with an expand toggle. */
export function JsonValue({ value }: TraceValueViewProps) {
  const [expanded, setExpanded] = useState(false);
  const text = expanded ? prettyJson(value) : prettyJson(buildPreviewPayload(value));
  return (
    <div className="space-y-2">
      <pre className="max-h-52 overflow-auto rounded-xl border border-hairline bg-canvas p-3 font-mono text-[11px] leading-relaxed text-body">
        {text}
      </pre>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="text-[10px] uppercase tracking-[0.25em] text-accent-cyan transition hover:brightness-110"
      >
        {expanded ? "Collapse" : "Expand"}
      </button>
    </div>
  );
}
