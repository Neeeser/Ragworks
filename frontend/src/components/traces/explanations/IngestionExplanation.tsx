import { ArrowRight, FileText } from "lucide-react";

import { ResultList } from "@/components/traces/explanations/ResultList";
import {
  embeddingSummary,
  itemLists,
  sourceSummary,
  summaryValue,
  textSummary,
} from "@/components/traces/explanations/summary-data";
import { fullTextFromRecords } from "@/components/traces/lib/artifacts";
import { journeySentence } from "@/components/traces/lib/journey-sentences";
import { isRecord } from "@/components/traces/values/shape-guards";
import { Button } from "@/components/ui/button";

import type { NodeExplanationProps } from "@/components/traces/explanations/types";

const labelClass = "font-mono text-[10px] uppercase tracking-[0.2em] text-meta";

function SourceCard({
  path,
  contentType,
}: {
  path: string;
  contentType: string | null | undefined;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <p className={labelClass}>Input file</p>
      <p className="mt-2 break-all font-mono text-xs text-primary">{path}</p>
      <p className="mt-2 font-mono text-[10px] text-muted">
        {contentType ?? "Unknown content type"}
      </p>
    </div>
  );
}

export function IngestionInputExplanation({ step }: NodeExplanationProps) {
  const source = sourceSummary(step, "outputs");
  if (!source) return null;
  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm leading-relaxed text-body">
        The ingestion run started with this stored file path and content type.
      </p>
      <SourceCard path={source.path} contentType={source.content_type} />
    </div>
  );
}

export function ParserExplanation({ step, contextItems, onOpenArtifact }: NodeExplanationProps) {
  const source = sourceSummary(step, "inputs");
  const text = textSummary(step, "outputs");
  if (!source || !text) return null;
  const fullText = fullTextFromRecords(step.io.outputs) ?? text.full;
  const sourceName =
    contextItems.find((item) => item.document_id === source.document_id)?.filename ??
    source.path.split("/").filter(Boolean).at(-1) ??
    "Parsed document";
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-body">
        The parser read the source file and normalized it to text for chunking.
      </p>
      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,0.8fr)_auto_minmax(0,1.2fr)]">
        <SourceCard path={source.path} contentType={source.content_type} />
        <div className="hidden items-center justify-center lg:flex">
          <ArrowRight className="h-5 w-5 text-accent-cyan" aria-hidden />
        </div>
        <div className="rounded-xl border border-accent-cyan/25 bg-accent-cyan/5 p-4">
          <div className="flex items-baseline gap-2">
            <p className={labelClass}>Parsed to text</p>
            <span className="font-mono text-[10px] text-meta">{text.length} characters</span>
          </div>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-body">
            {text.preview}
          </p>
          {fullText && onOpenArtifact ? (
            <div className="mt-3 flex justify-end border-t border-hairline pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  onOpenArtifact({
                    id: source.document_id,
                    status: "resolved",
                    text: fullText,
                    document_id: source.document_id,
                    filename: `${sourceName} · Parsed text`,
                  })
                }
                className="gap-1.5"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Open parsed text
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-body">
        <span>Split parsed text into {chunks.items.length} ordered chunks.</span>
        {typeof size === "number" ? (
          <span className="rounded-full border border-hairline bg-surface px-2 py-1 font-mono text-[10px] text-muted">
            {size} tokens
          </span>
        ) : null}
        {typeof overlap === "number" ? (
          <span className="rounded-full border border-hairline bg-surface px-2 py-1 font-mono text-[10px] text-muted">
            {overlap} overlap
          </span>
        ) : null}
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
    <div className="max-w-3xl space-y-4">
      <p className="text-sm leading-relaxed text-body">
        {query
          ? "Converted the query text into one vector for semantic retrieval."
          : `Converted ${count} chunks into vectors for semantic indexing.`}
      </p>
      {query ? (
        <div className="rounded-xl border border-hairline bg-surface p-4">
          <p className={labelClass}>Query</p>
          <p className="mt-2 text-sm text-primary">{query.full ?? query.preview}</p>
        </div>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-hairline bg-surface p-3">
          <dt className={labelClass}>Vectors</dt>
          <dd className="mt-1 text-lg font-semibold text-primary">{count}</dd>
        </div>
        <div className="rounded-xl border border-hairline bg-surface p-3">
          <dt className={labelClass}>Dimensions</dt>
          <dd className="mt-1 text-lg font-semibold text-primary">{dimension ?? "—"}</dd>
        </div>
        <div className="rounded-xl border border-hairline bg-surface p-3">
          <dt className={labelClass}>Model</dt>
          <dd className="mt-1 truncate font-mono text-xs text-primary">{String(model ?? "—")}</dd>
        </div>
      </dl>
    </div>
  );
}

export function IndexerExplanation(props: NodeExplanationProps) {
  const indexed = summaryValue(props.step, "Indexed chunks");
  const count = isRecord(indexed) && typeof indexed.count === "number" ? indexed.count : null;
  const backend = isRecord(indexed) && typeof indexed.backend === "string" ? indexed.backend : null;
  const indexName = props.node.data.config.index_name;
  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm leading-relaxed text-body">
        Stored {count ?? "the"} chunks in this index without changing their document order.
      </p>
      <dl className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Index", indexName],
            ["Backend", backend ?? props.node.data.config.backend],
            ["Chunks", count],
          ] as Array<[string, unknown]>
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-hairline bg-surface p-3">
            <dt className={labelClass}>{label}</dt>
            <dd className="mt-1 truncate font-mono text-xs text-primary">{String(value ?? "—")}</dd>
          </div>
        ))}
      </dl>
      {props.itemEffect ? (
        <p className="rounded-xl border border-accent-cyan/30 bg-accent-cyan/5 p-3 text-sm text-primary">
          {journeySentence(props.itemEffect)}
        </p>
      ) : null}
    </div>
  );
}

export function IngestionOutputExplanation(props: NodeExplanationProps) {
  const branches = itemLists(props.step, "inputs");
  const result = itemLists(props.step, "outputs")[0]?.list;
  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm leading-relaxed text-body">
        Combined {branches.length} indexing branches into the persisted ingestion result.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {branches.map((branch, index) => (
          <div key={branch.label} className="rounded-xl border border-hairline bg-surface p-3">
            <p className={labelClass}>{props.inputSources[index] ?? `Branch ${index + 1}`}</p>
            <p className="mt-1 text-sm font-medium text-primary">
              {branch.list.items.length} chunks
            </p>
          </div>
        ))}
      </div>
      {result && props.itemEffect ? (
        <p className="rounded-xl border border-accent-cyan/30 bg-accent-cyan/5 p-3 text-sm text-primary">
          {journeySentence(props.itemEffect)}
        </p>
      ) : null}
    </div>
  );
}
