import { ArrowRight, FileText } from "lucide-react";

import { FileCard } from "@/components/traces/explanations/FileCard";
import { Lede } from "@/components/traces/explanations/prose";
import {
  fileSummary,
  imageSummary,
  parsedTextSummary,
  summaryValue,
} from "@/components/traces/explanations/summary-data";
import { fullTextFromRecords } from "@/components/traces/lib/artifacts";
import { isRecord } from "@/components/traces/values/shape-guards";
import { ImageSummaryValue } from "@/components/traces/values/TraceValueViews";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";

import type { NodeExplanationProps } from "@/components/traces/explanations/types";
import type { ReactNode } from "react";

/** The file's own name, from a stored path like `documents/<uuid>/report.pdf`. */
const fileName = (path: string | undefined): string | undefined =>
  path?.split("/").filter(Boolean).pop();

/** The file card, an arrow, and what the node made of it. */
function ParseFlow({
  file,
  children,
}: {
  file: ReturnType<typeof fileSummary>;
  children: ReactNode;
}) {
  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,0.8fr)_auto_minmax(0,1.2fr)]">
      <FileCard file={file} />
      <div className="hidden items-center justify-center lg:flex">
        <ArrowRight className="h-4 w-4 text-accent-cyan" aria-hidden />
      </div>
      {children}
    </div>
  );
}

/** What the node produced, in a card that reads as this node's output. */
function OutcomeCard({
  label,
  right,
  children,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-panel border border-accent-cyan/25 bg-accent-cyan/5 p-3">
      <div className="flex items-baseline gap-2">
        <InstrumentLabel>{label}</InstrumentLabel>
        {right}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * The content types this node had no handler for, from the trace's own
 * `Unread files` value. A node that declined the file and a node that read
 * it and found nothing both emit no items, and only this tells them apart.
 */
function declinedTypes(step: NodeExplanationProps["step"]): string[] {
  const unread = summaryValue(step, "Unread files");
  if (!isRecord(unread) || !Array.isArray(unread.media_types)) return [];
  return unread.media_types.filter((type): type is string => typeof type === "string");
}

/** What a step that declined the file says, in place of a per-node outcome. */
const noHandlerLine = (types: string[]): string =>
  `This step has no handler for ${types.join(", ")}, so it read nothing.`;

/** What Extract Text opens with, given whether it declined or read the file. */
const textLede = (declined: string[], hasText: boolean): string => {
  if (declined.length > 0) return "The file's content type has no text handler in this step.";
  return hasText
    ? "Read the file through the handler for its content type and emitted one text item."
    : "Read the file through the handler for its content type.";
};

/** The node ran and the file held nothing for it — stated, not left blank. */
function ProducedNothing({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-panel border border-hairline bg-surface p-3">
      <InstrumentLabel>Produced nothing</InstrumentLabel>
      <p className="mt-2 max-w-[66ch] text-ui leading-relaxed text-body">{children}</p>
    </div>
  );
}

export function ParseTextExplanation({ step, contextItems, onOpenArtifact }: NodeExplanationProps) {
  const file = fileSummary(step, "inputs");
  const parsed = parsedTextSummary(step);
  const declined = declinedTypes(step);
  const text = parsed?.text ?? null;
  const fullText = fullTextFromRecords(step.io.outputs) ?? text?.full;
  // A document trace opened without a chunk resolves no context items, and the
  // extracted text is the artifact that trace exists to show — so the button
  // depends on the text alone, and names the file from the trace when no chunk
  // carries a filename.
  const document = contextItems[0];
  const sourceName = document?.filename ?? fileName(file?.paths?.[0]) ?? "Extracted text";
  return (
    <div className="space-y-3">
      <Lede>{textLede(declined, Boolean(text))}</Lede>
      <ParseFlow file={file}>
        {text ? (
          <OutcomeCard
            label="Extracted text"
            right={
              <Readout label="Characters" className="ml-auto">
                {text.length}
              </Readout>
            }
          >
            <p className="line-clamp-4 max-w-[66ch] whitespace-pre-wrap text-ui leading-relaxed text-body">
              {text.preview}
            </p>
            {fullText && onOpenArtifact ? (
              <div className="mt-3 flex justify-end border-t border-hairline pt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    onOpenArtifact({
                      id: document?.id ?? `${step.nodeId}:text`,
                      status: "resolved",
                      text: fullText,
                      document_id: document?.document_id,
                      filename: `${sourceName} · Extracted text`,
                    })
                  }
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Open extracted text
                </Button>
              </div>
            ) : null}
          </OutcomeCard>
        ) : (
          <ProducedNothing>
            {declined.length > 0
              ? noHandlerLine(declined)
              : "The file carries no text layer, so this step emitted no text items."}
          </ProducedNothing>
        )}
      </ParseFlow>
    </div>
  );
}

type MediaCopy = {
  /** What the card of produced images is called at this node. */
  cardLabel: string;
  produced: (count: number) => string;
  empty: (config: Record<string, unknown>) => string;
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

const pixelFilter = (config: Record<string, unknown>): string =>
  typeof config.min_width === "number" && typeof config.min_height === "number"
    ? ` at least ${config.min_width}×${config.min_height} pixels`
    : "";

const MEDIA_COPY: Record<string, MediaCopy> = {
  "parse.embedded_media": {
    cardLabel: "Extracted images",
    produced: (count) => `Pulled ${plural(count, "image")} out of the file.`,
    empty: (config) => `The file carries no embedded images${pixelFilter(config)}.`,
  },
  "parse.page_images": {
    cardLabel: "Rendered pages",
    produced: (count) => `Rendered ${plural(count, "page")} of the file as images.`,
    empty: () => "The file has no pages to render.",
  },
  "parse.media_file": {
    cardLabel: "Image",
    produced: (count) => `Read the uploaded file as ${plural(count, "image item")}.`,
    empty: () => "The file carries no readable image.",
  },
};

/** Parse nodes whose output is an image stream: embedded media, pages, media files. */
export function ParseMediaExplanation({ step, node }: NodeExplanationProps) {
  const file = fileSummary(step, "inputs");
  const images = imageSummary(step, "outputs");
  const declined = declinedTypes(step);
  const copy = MEDIA_COPY[node.data.nodeType] ?? {
    cardLabel: "Images",
    produced: (count: number) => `Produced ${plural(count, "image item")} from the file.`,
    empty: () => "This step produced no image items.",
  };
  const count = images?.count ?? 0;
  return (
    <div className="space-y-3">
      <Lede>
        {declined.length > 0
          ? "The file's content type has no handler in this step."
          : count > 0
            ? copy.produced(count)
            : "Read the file and produced no images."}
      </Lede>
      <ParseFlow file={file}>
        {images && count > 0 ? (
          <OutcomeCard label={copy.cardLabel}>
            <ImageSummaryValue value={images} kind="json" />
          </OutcomeCard>
        ) : (
          <ProducedNothing>
            {declined.length > 0 ? noHandlerLine(declined) : copy.empty(node.data.config)}
          </ProducedNothing>
        )}
      </ParseFlow>
    </div>
  );
}
