import { FileCard } from "@/components/traces/explanations/FileCard";
import { EffectNote, Lede } from "@/components/traces/explanations/prose";
import { ResultList } from "@/components/traces/explanations/ResultList";
import {
  embeddingSummary,
  fileSummary,
  itemLists,
  summaryValue,
  textSummary,
} from "@/components/traces/explanations/summary-data";
import { journeySentence } from "@/components/traces/lib/journey-sentences";
import { isRecord } from "@/components/traces/values/shape-guards";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";

import type { NodeExplanationProps } from "@/components/traces/explanations/types";

export function IngestionInputExplanation({ step }: NodeExplanationProps) {
  const file = fileSummary(step, "outputs");
  if (!file) return null;
  return (
    <div className="max-w-3xl space-y-3">
      <Lede>The ingestion run started with this stored file path and content type.</Lede>
      <FileCard file={file} />
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
