import { ArrowRight } from "lucide-react";

import {
  buildPipelineConfigFields,
  getInputValue,
} from "@/components/pipelines/lib/pipeline-config";
import { plural } from "@/components/traces/explanations/copy";
import { OutcomeCard } from "@/components/traces/explanations/OutcomeCard";
import { Lede } from "@/components/traces/explanations/prose";
import { imageSummary, summaryValue } from "@/components/traces/explanations/summary-data";
import { isRecord } from "@/components/traces/values/shape-guards";
import { ImageSummaryValue } from "@/components/traces/values/TraceValueViews";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";

import type { PipelineConfigField } from "@/components/pipelines/lib/pipeline-config";
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

/** The grid is columns by rows, which a bare `3x4` does not say. */
const GRID_LABEL = "Grid (columns × rows)";

const UNREADABLE_LABEL = "Unreadable";
const UNCHANGED_LABEL = "Unchanged";

type Readouts = Array<[string, string | number]>;

type ExplanationNode = NodeExplanationProps["node"];

/** What one `image.resize` run did to each image that reached it. */
type ResizeCounts = { resized: number; unchanged: number; unreadable: number };

/** What one `image.tile` run did to each image that reached it. */
type TileCounts = { sources: number; tiles: number; unchanged: number; unreadable: number };

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
 * The number a config field will run with: the stored value, else that field's
 * own schema default. Config patches are sparse, so a field the user never
 * touched is absent from the stored config while the node still runs on its
 * default. An expression-valued field resolves during the run, so it reads as
 * unknown rather than as a number the run will not use.
 */
const configNumber = (
  node: ExplanationNode,
  fields: PipelineConfigField[],
  key: string,
): number | null => {
  const field = fields.find((entry) => entry.key === key);
  const value = field ? getInputValue(field, node.data.config) : node.data.config[key];
  return typeof value === "number" ? value : null;
};

/** `1568×1568` from a pair of config fields, or null when either is unknown. */
const pixelBox = (
  node: ExplanationNode,
  fields: PipelineConfigField[],
  widthKey: string,
  heightKey: string,
): string | null => {
  const width = configNumber(node, fields, widthKey);
  const height = configNumber(node, fields, heightKey);
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

/**
 * An image the node never decoded. It is counted apart from the images that
 * were measured and left alone, because "we could not read it" and "it was
 * already the right size" are different outcomes with the same output bytes.
 */
const unreadableSentence = (unreadable: number): string =>
  `${plural(unreadable, "image")} could not be read and passed through unchanged.`;

const resizeLede = (counts: ResizeCounts, box: string | null): string => {
  const within = box ? `within ${box} pixels` : "within the maximum size";
  const parts: string[] = [];
  if (counts.resized > 0) {
    parts.push(`Resized ${plural(counts.resized, "image")} to fit ${within}.`);
  }
  if (counts.unchanged > 0) {
    parts.push(
      counts.resized > 0
        ? `${plural(counts.unchanged, "image")} already fitted and passed through.`
        : `${plural(counts.unchanged, "image")} already fitted ${within}, so nothing was rewritten.`,
    );
  }
  if (counts.unreadable > 0) {
    parts.push(unreadableSentence(counts.unreadable));
  }
  return parts.length > 0 ? parts.join(" ") : NO_IMAGES;
};

export function ImageResizeExplanation({ step, node }: NodeExplanationProps) {
  const input = imageSummary(step, "inputs");
  const stats = record(step, "Resized");
  const fields = buildPipelineConfigFields(node.data.configSchema);
  const resized = numberAt(stats, "resized") ?? 0;
  const counts: ResizeCounts = {
    resized,
    // A trace recorded before the unreadable counter existed folded those
    // images into the images that arrived; derive from what it did record.
    unchanged: numberAt(stats, "unchanged") ?? Math.max((input?.count ?? 0) - resized, 0),
    unreadable: numberAt(stats, "unreadable") ?? 0,
  };
  const box = pixelBox(node, fields, "max_width", "max_height");
  const readouts: Readouts = [
    ["Maximum size", box ?? "—"],
    ["Resized", counts.resized],
    [UNCHANGED_LABEL, counts.unchanged],
  ];
  if (counts.unreadable > 0) {
    readouts.push([UNREADABLE_LABEL, counts.unreadable]);
  }
  return (
    <ImageTransformBody
      step={step}
      input={input}
      lede={resizeLede(counts, box)}
      readouts={readouts}
    />
  );
}

const tileLede = (counts: TileCounts, box: string | null): string => {
  const parts: string[] = [];
  if (counts.tiles > 0) {
    // Edge tiles are clipped to the image, so the configured size is a ceiling
    // every tile is at or under, never the size each tile has.
    const size = box ? ` no larger than ${box} pixels` : "";
    parts.push(
      `Split ${plural(counts.sources, "image")} into ${plural(counts.tiles, "tile")}${size}.`,
    );
    if (counts.unchanged > 0) {
      parts.push(`${plural(counts.unchanged, "image")} fitted in one tile and passed through.`);
    }
  } else if (counts.unchanged > 0) {
    const size = box ? ` of ${box} pixels` : "";
    parts.push(
      `${plural(counts.unchanged, "image")} fitted in one tile${size}, so nothing was split.`,
    );
  }
  if (counts.unreadable > 0) {
    parts.push(unreadableSentence(counts.unreadable));
  }
  return parts.length > 0 ? parts.join(" ") : NO_IMAGES;
};

export function ImageTileExplanation({ step, node }: NodeExplanationProps) {
  const input = imageSummary(step, "inputs");
  const stats = record(step, "Tiles");
  const fields = buildPipelineConfigFields(node.data.configSchema);
  const sources = numberAt(stats, "sources") ?? 0;
  const counts: TileCounts = {
    sources,
    tiles: numberAt(stats, "tiles") ?? 0,
    unchanged: numberAt(stats, "unchanged") ?? Math.max((input?.count ?? 0) - sources, 0),
    unreadable: numberAt(stats, "unreadable") ?? 0,
  };
  const grid = stringAt(stats, "grid");
  const box = pixelBox(node, fields, "tile_width", "tile_height");
  const overlap = configNumber(node, fields, "overlap");
  const readouts: Readouts = [
    ["Tile size", box ?? "—"],
    ["Overlap", overlap ?? "—"],
    ["Tiles", counts.tiles],
    [UNCHANGED_LABEL, counts.unchanged],
  ];
  // A grid belongs to one image's split. It is reported only when a single
  // image was tiled, where it is the whole run; over several it would present
  // one page's shape as the run's.
  if (grid !== null && counts.sources === 1) {
    readouts.push([GRID_LABEL, grid]);
  }
  if (counts.unreadable > 0) {
    readouts.push([UNREADABLE_LABEL, counts.unreadable]);
  }
  return (
    <ImageTransformBody
      step={step}
      input={input}
      lede={tileLede(counts, box)}
      readouts={readouts}
    />
  );
}
