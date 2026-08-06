import { ArrowRight } from "lucide-react";

import { plural } from "@/components/traces/explanations/copy";
import { OutcomeCard } from "@/components/traces/explanations/OutcomeCard";
import { Lede } from "@/components/traces/explanations/prose";
import { imageSummary, summaryValue } from "@/components/traces/explanations/summary-data";
import { isRecord } from "@/components/traces/values/shape-guards";
import { ImageSummaryValue } from "@/components/traces/values/TraceValueViews";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";

import type { NodeExplanationProps } from "@/components/traces/explanations/types";
import type { TraceStep } from "@/components/traces/trace-graph";
import type { ImageSummaryShape } from "@/components/traces/values/shape-guards";

/**
 * The items→items image transforms (`image.resize`, `image.tile`). Both act on
 * an image stream and pass everything else through, so both explain the same
 * three facts: what arrived, what the node did to it, and what left.
 */

/** What a step whose image stream was empty says, in place of a count. */
const NO_IMAGES = "No image items reached this step.";

type Readouts = Array<[string, string | number]>;

const record = (step: TraceStep, label: string): Record<string, unknown> | null => {
  const value = summaryValue(step, label);
  return isRecord(value) ? value : null;
};

const numberAt = (source: Record<string, unknown> | null, key: string): number | null => {
  const value = source?.[key];
  return typeof value === "number" ? value : null;
};

const stringAt = (source: Record<string, unknown> | null, key: string): string | null => {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
};

/**
 * `1568×1568 pixels` from a pair of config fields. A stored definition may
 * leave a field at the node's own default, in which case the trace states the
 * limit by name rather than inventing the number the backend used.
 */
const pixelBox = (
  config: Record<string, unknown>,
  widthKey: string,
  heightKey: string,
): string | null => {
  const width = numberAt(config, widthKey);
  const height = numberAt(config, heightKey);
  return width !== null && height !== null ? `${width}×${height}` : null;
};

/** The warnings the node recorded, e.g. an image whose bytes would not open. */
const warningLines = (step: TraceStep): string[] => {
  const value = summaryValue(step, "Warnings");
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

function StreamCard({ label, summary }: { label: string; summary: ImageSummaryShape | null }) {
  return (
    <div className="rounded-panel border border-hairline bg-surface p-3">
      <InstrumentLabel>{label}</InstrumentLabel>
      <div className="mt-2">
        {summary ? (
          <ImageSummaryValue value={summary} kind="json" />
        ) : (
          <p className="text-ui text-body">No image items.</p>
        )}
      </div>
    </div>
  );
}

function WarningCard({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-panel border border-data-warn/30 bg-data-warn/5 p-3">
      <InstrumentLabel>Warnings</InstrumentLabel>
      <ul className="mt-2 space-y-1">
        {lines.map((line) => (
          <li key={line} className="max-w-[66ch] text-ui leading-relaxed text-body">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImageTransformBody({
  step,
  input,
  lede,
  readouts,
}: {
  step: TraceStep;
  input: ImageSummaryShape | null;
  lede: string;
  readouts: Readouts;
}) {
  const output = imageSummary(step, "outputs");
  const passedThrough = numberAt(record(step, "Passed through"), "count") ?? 0;
  const warnings = warningLines(step);
  return (
    <div className="space-y-3">
      <Lede>{lede}</Lede>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {readouts.map(([label, value]) => (
          <Readout key={label} label={label}>
            {value}
          </Readout>
        ))}
        {passedThrough > 0 ? <Readout label="Passed through">{passedThrough}</Readout> : null}
      </div>
      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <StreamCard label="Images in" summary={input} />
        <div className="hidden items-center justify-center lg:flex">
          <ArrowRight className="h-4 w-4 text-accent-cyan" aria-hidden />
        </div>
        <OutcomeCard label="Items out">
          {output ? (
            <ImageSummaryValue value={output} kind="json" />
          ) : (
            <p className="text-ui text-body">No image items.</p>
          )}
        </OutcomeCard>
      </div>
      {warnings.length > 0 ? <WarningCard lines={warnings} /> : null}
    </div>
  );
}

const resizeLede = (resized: number, unchanged: number, limit: string): string => {
  if (resized > 0) {
    const rest =
      unchanged > 0 ? ` ${plural(unchanged, "image")} already fitted and passed through.` : "";
    return `Resized ${plural(resized, "image")} to fit within ${limit}.${rest}`;
  }
  if (unchanged > 0) {
    return `${plural(unchanged, "image")} already fitted within ${limit}, so nothing was rewritten.`;
  }
  return NO_IMAGES;
};

export function ImageResizeExplanation({ step, node }: NodeExplanationProps) {
  const input = imageSummary(step, "inputs");
  const stats = record(step, "Resized");
  const resized = numberAt(stats, "resized") ?? 0;
  const unchanged = numberAt(stats, "unchanged") ?? 0;
  const box = pixelBox(node.data.config, "max_width", "max_height");
  const readouts: Readouts = [
    ["Maximum size", box ?? "—"],
    ["Resized", resized],
    ["Unchanged", unchanged],
  ];
  return (
    <ImageTransformBody
      step={step}
      input={input}
      lede={resizeLede(resized, unchanged, box ? `${box} pixels` : "the maximum size")}
      readouts={readouts}
    />
  );
}

const tileLede = (sources: number, tiles: number, arrived: number, size: string): string => {
  if (tiles > 0) {
    return `Split ${plural(sources, "image")} into ${plural(tiles, "tile")} of ${size}.`;
  }
  if (arrived > 0) {
    return `${plural(arrived, "image")} fitted in one tile of ${size}, so nothing was split.`;
  }
  return NO_IMAGES;
};

export function ImageTileExplanation({ step, node }: NodeExplanationProps) {
  const input = imageSummary(step, "inputs");
  const stats = record(step, "Tiles");
  const sources = numberAt(stats, "sources") ?? 0;
  const tiles = numberAt(stats, "tiles") ?? 0;
  const grid = stringAt(stats, "grid");
  const box = pixelBox(node.data.config, "tile_width", "tile_height");
  const overlap = numberAt(node.data.config, "overlap");
  const readouts: Readouts = [
    ["Tile size", box ?? "—"],
    ["Overlap", overlap ?? "—"],
    ["Tiles", tiles],
  ];
  if (grid) {
    readouts.push(["Grid", grid]);
  }
  return (
    <ImageTransformBody
      step={step}
      input={input}
      lede={tileLede(sources, tiles, input?.count ?? 0, box ? `${box} pixels` : "the tile size")}
      readouts={readouts}
    />
  );
}
