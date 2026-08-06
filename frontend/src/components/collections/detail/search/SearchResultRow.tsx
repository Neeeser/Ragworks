"use client";

import { FileText } from "lucide-react";
import { useState } from "react";

import { AssetImage } from "@/components/ui/asset-image";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Meter } from "@/components/ui/meter";
import { Readout } from "@/components/ui/readout";
import { imageAssetOf } from "@/lib/media-asset";
import { cn } from "@/lib/utils";

import type { QueryChunk } from "@/lib/types";

const ID_METADATA_KEYS = new Set(["document_id", "collection_id", "chunk_id", "id"]);

function documentLabel(chunk: QueryChunk): string {
  const metadata = chunk.metadata ?? {};
  for (const key of ["filename", "document_name", "file_name", "name", "source"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  if (typeof chunk.document_id === "string" && chunk.document_id) {
    return `Document ${chunk.document_id.slice(0, 8)}`;
  }
  return "Document";
}

/**
 * The result's score, next to a bar showing it relative to the run's best
 * match — the one thing a raw score cannot say on its own, since scores are
 * only comparable within a single query.
 */
function ScoreCell({ score, topScore }: { score: number; topScore: number }) {
  const share = topScore > 0 ? Math.max(0.04, score / topScore) : 0;
  return (
    <span className="flex shrink-0 items-center gap-2">
      <Readout label="Score">{score.toFixed(3)}</Readout>
      <Meter value={share} className="h-1 w-16 shrink-0" />
    </span>
  );
}

type SearchResultRowProps = {
  chunk: QueryChunk;
  rank: number;
  topScore: number;
  /** Auth + collection scope for fetching a match's image asset bytes. */
  token: string;
  collectionId: string;
  /** Absent when the run recorded no query event — a button that opens
   * nothing is worse than no button. */
  onTrace?: () => void;
};

/**
 * One retrieved chunk, as a row inside the results card.
 *
 * Rows, not cards: a card per result inside the results card was three levels
 * of container, and every chunk's own bordered box competed with the card it
 * sat in. The chunk text keeps a `66ch` measure while the row stays full-width,
 * because the text is the one thing here a user reads rather than scans.
 */
export function SearchResultRow({
  chunk,
  rank,
  topScore,
  token,
  collectionId,
  onTrace,
}: SearchResultRowProps) {
  const [expanded, setExpanded] = useState(false);
  const score = chunk.score ?? 0;
  const text = chunk.text ?? "";
  const asset = imageAssetOf(chunk.metadata);
  // Raw ids are trace territory — the Trace button already leads there.
  const metadataEntries = Object.entries(chunk.metadata ?? {})
    .filter(([key]) => !ID_METADATA_KEYS.has(key))
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 4);

  return (
    <li className="flex items-start gap-3 border-b border-hairline px-3 py-2 last:border-b-0">
      <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-ui tabular-nums text-meta">
        <span className="sr-only">Rank </span>
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            <span className="truncate text-ui font-medium text-primary">
              {documentLabel(chunk)}
            </span>
          </span>
          <ScoreCell score={score} topScore={topScore} />
        </div>

        {asset ? (
          <AssetImage
            token={token}
            source={{ collectionId }}
            asset={asset}
            alt={`Image match: ${documentLabel(chunk)}`}
            className="mt-1.5"
          />
        ) : null}

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 block w-full rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
        >
          <p
            className={cn(
              "max-w-[66ch] whitespace-pre-wrap text-ui leading-relaxed text-body",
              !expanded && "line-clamp-3",
            )}
          >
            {text}
          </p>
          <InstrumentLabel className="mt-1 inline-block">
            {expanded ? "Collapse" : "Expand"}
          </InstrumentLabel>
        </button>

        {metadataEntries.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {metadataEntries.map(([key, value]) => (
              // A metadata key/value pair is a literal, so it renders verbatim
              // in mono rather than through the sentence-case `Chip` voice.
              <span
                key={key}
                className="max-w-full truncate rounded-full bg-surface px-2 py-0.5 font-mono text-instrument text-meta"
              >
                {key}: {String(value)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* A sibling of the expand button, never nested inside it. */}
      {onTrace ? (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onTrace}>
          Trace result
        </Button>
      ) : null}
    </li>
  );
}
