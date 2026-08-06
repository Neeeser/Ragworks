import { ArrowRight, FileText } from "lucide-react";

import { EffectNote, Lede } from "@/components/traces/explanations/prose";
import { ResultList } from "@/components/traces/explanations/ResultList";
import {
  embeddingSummary,
  fileSummary,
  itemLists,
  summaryValue,
  textSummary,
} from "@/components/traces/explanations/summary-data";
import { fullTextFromRecords } from "@/components/traces/lib/artifacts";
import { journeySentence } from "@/components/traces/lib/journey-sentences";
import { isRecord } from "@/components/traces/values/shape-guards";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";

import type { NodeExplanationProps } from "@/components/traces/explanations/types";

function FileCard({ paths, mediaTypes }: { paths: string[]; mediaTypes: string[] }) {
  return (
    <div className="rounded-panel border border-hairline bg-surface p-3">
      <InstrumentLabel>Input file</InstrumentLabel>
      {paths.length > 0 ? (
        paths.map((path) => (
          <p key={path} className="mt-1 break-all font-mono text-ui text-primary">
            {path}
          </p>
        ))
      ) : (
        <p className="mt-1 font-mono text-ui text-primary">—</p>
      )}
      <p className="mt-1 font-mono text-instrument text-muted">
        {mediaTypes.length > 0 ? mediaTypes.join(", ") : "Unknown content type"}
      </p>
    </div>
  );
}

export function IngestionInputExplanation({ step }: NodeExplanationProps) {
  const file = fileSummary(step, "outputs");
  if (!file) return null;
  return (
    <div className="max-w-3xl space-y-3">
      <Lede>The ingestion run started with this stored file path and content type.</Lede>
      <FileCard paths={file.paths ?? []} mediaTypes={file.media_types} />
    </div>
  );
}

/** The file's own name, from a stored path like `documents/<uuid>/report.pdf`. */
const fileName = (path: string | undefined): string | undefined =>
  path?.split("/").filter(Boolean).pop();

export function ParseTextExplanation({ step, contextItems, onOpenArtifact }: NodeExplanationProps) {
  const file = fileSummary(step, "inputs");
  const text = textSummary(step, "outputs");
  if (!file || !text) return null;
  const fullText = fullTextFromRecords(step.io.outputs) ?? text.full;
  // A document trace opened without a chunk resolves no context items, and the
  // extracted text is the artifact that trace exists to show — so the button
  // depends on the text alone, and names the file from the trace when no chunk
  // carries a filename.
  const document = contextItems[0];
  const sourceName = document?.filename ?? fileName(file.paths?.[0]) ?? "Extracted text";
  return (
    <div className="space-y-3">
      <Lede>
        Extract Text read the file through the handler for its content type and emitted one text
        item.
      </Lede>
      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,0.8fr)_auto_minmax(0,1.2fr)]">
        <FileCard paths={file.paths ?? []} mediaTypes={file.media_types} />
        <div className="hidden items-center justify-center lg:flex">
          <ArrowRight className="h-4 w-4 text-accent-cyan" aria-hidden />
        </div>
        <div className="rounded-panel border border-accent-cyan/25 bg-accent-cyan/5 p-3">
          <div className="flex items-baseline gap-2">
            <InstrumentLabel>Extracted text</InstrumentLabel>
            <Readout label="Characters" className="ml-auto">
              {text.length}
            </Readout>
          </div>
          <p className="mt-2 line-clamp-4 max-w-[66ch] whitespace-pre-wrap text-ui leading-relaxed text-body">
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
        </div>
      </div>
    </div>
  );
}

export function ChunkerExplanation(props: NodeExplanationProps) {
  const chunks = itemLists(props.step, "outputs")[0]?.list;
  if (!chunks) return null;
  const size = props.node.data.config.chunk_size;
  const overlap = props.node.data.config.chunk_overlap;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Lede>Split the extracted text into {chunks.items.length} ordered chunks.</Lede>
        {typeof size === "number" ? (
          <Readout label="Chunk size">
            {size}
            <span className="text-muted"> tokens</span>
          </Readout>
        ) : null}
        {typeof overlap === "number" ? <Readout label="Overlap">{overlap}</Readout> : null}
      </div>
      <ResultList
        title="Chunk order"
        ariaLabel="Chunk neighborhood"
        items={chunks.items}
        focusedItemId={props.focusedItemId}
        contextItems={props.contextItems}
        onFocusItem={props.onFocusItem}
        onOpenArtifact={props.onOpenArtifact}
      />
    </div>
  );
}

export function EmbedderExplanation(props: NodeExplanationProps) {
  const embedding = embeddingSummary(props.step, "outputs");
  const query = textSummary(props.step, "inputs");
  const dimension = embedding
    ? "dimension" in embedding
      ? embedding.dimension
      : embedding.total_values
    : null;
  const count = embedding && "count" in embedding ? embedding.count : 1;
  const model = props.node.data.config.model_name;
  return (
    <div className="max-w-3xl space-y-3">
      <Lede>
        {query
          ? "Converted the query text into one vector for semantic retrieval."
          : `Converted ${count} chunks into vectors for semantic indexing.`}
      </Lede>
      {query ? (
        <div className="rounded-panel border border-hairline bg-surface p-3">
          <InstrumentLabel>Query</InstrumentLabel>
          <p className="mt-1 max-w-[66ch] text-ui text-primary">{query.full ?? query.preview}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Readout label="Vectors">{count}</Readout>
        <Readout label="Dimensions">{dimension ?? "—"}</Readout>
        <Readout label="Model" className="min-w-0">
          {String(model ?? "—")}
        </Readout>
      </div>
    </div>
  );
}

export function IndexerExplanation(props: NodeExplanationProps) {
  const indexed = summaryValue(props.step, "Indexed chunks");
  const count = isRecord(indexed) && typeof indexed.count === "number" ? indexed.count : null;
  const backend = isRecord(indexed) && typeof indexed.backend === "string" ? indexed.backend : null;
  const indexName = props.node.data.config.index_name;
  return (
    <div className="max-w-3xl space-y-3">
      <Lede>
        Stored {count ?? "the"} chunks in this index without changing their document order.
      </Lede>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(
          [
            ["Index", indexName],
            ["Backend", backend ?? props.node.data.config.backend],
            ["Chunks", count],
          ] as Array<[string, unknown]>
        ).map(([label, value]) => (
          <Readout key={label} label={label} className="min-w-0">
            {String(value ?? "—")}
          </Readout>
        ))}
      </div>
      {props.itemEffect ? <EffectNote>{journeySentence(props.itemEffect)}</EffectNote> : null}
    </div>
  );
}

export function IngestionOutputExplanation(props: NodeExplanationProps) {
  const branches = itemLists(props.step, "inputs");
  const result = itemLists(props.step, "outputs")[0]?.list;
  return (
    <div className="max-w-3xl space-y-3">
      <Lede>Combined {branches.length} indexing branches into the persisted ingestion result.</Lede>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {branches.map((branch, index) => (
          <Readout
            key={branch.label}
            label={props.inputSources[index] ?? `Branch ${index + 1}`}
            className="min-w-0"
          >
            {branch.list.items.length}
            <span className="text-muted"> chunks</span>
          </Readout>
        ))}
      </div>
      {result && props.itemEffect ? (
        <EffectNote>{journeySentence(props.itemEffect)}</EffectNote>
      ) : null}
    </div>
  );
}
