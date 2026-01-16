"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { PipelineTraceViewer } from "@/components/traces/PipelineTraceViewer";
import { Button } from "@/components/ui/button";
import { fetchPipelineRunTrace, fetchQueryEventTrace } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import type { PipelineTraceResponse } from "@/lib/types";

export const JsonBlock = ({
  data,
  className,
  maxHeight = 240,
}: {
  data: unknown;
  className?: string;
  maxHeight?: number;
}) => (
  <pre
    style={{ maxHeight }}
    className={cn(
      "overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950/40 p-3 text-xs text-slate-100",
      className,
    )}
  >
    {stringifyData(data)}
  </pre>
);

const stringifyData = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const truncateText = (value: string, limit = 360): string => {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}…`;
};

interface ToolValueProps {
  value: unknown;
}

export const ToolValue = ({ value }: ToolValueProps) => {
  if (value === null || value === undefined) {
    return <span className="text-slate-400">N/A</span>;
  }
  if (typeof value === "string") {
    return <span className="font-medium text-white">{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <code className="rounded bg-white/10 px-1 py-0.5 text-xs text-cyan-200">{String(value)}</code>
    );
  }
  if (Array.isArray(value)) {
    const primitiveItems = value.every(
      (item) =>
        item === null ||
        item === undefined ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );
    if (primitiveItems) {
      return (
        <ul className="list-disc space-y-1 pl-5 text-slate-100">
          {value.map((item, index) => (
            <li key={`tool-value-${index}`}>{String(item ?? "N/A")}</li>
          ))}
        </ul>
      );
    }
    return <JsonBlock data={value} />;
  }
  if (typeof value === "object") {
    return <JsonBlock data={value} />;
  }
  return <span className="text-white">{String(value)}</span>;
};

interface ToolKeyValueGridProps {
  data: Record<string, unknown>;
  emptyLabel?: string;
}

export const ToolKeyValueGrid = ({
  data,
  emptyLabel = "No data available.",
}: ToolKeyValueGridProps) => {
  const entries = Object.entries(data).filter((entry) => {
    const value = entry[1];
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return true;
  });

  if (entries.length === 0) {
    return <p className="text-xs text-slate-400">{emptyLabel}</p>;
  }

  return (
    <dl className="grid gap-3 text-left sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-2xl border border-white/10 bg-slate-950/30 p-3">
          <dt className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
            {formatKeyLabel(key)}
          </dt>
          <dd className="mt-1 text-sm">
            <ToolValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

interface ToolPayloadSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export const ToolPayloadSection = ({
  title,
  description,
  children,
  collapsible = false,
  defaultOpen = true,
}: ToolPayloadSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
        <header>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-300">{title}</p>
          {description && <p className="text-xs text-slate-400">{description}</p>}
        </header>
        {children}
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-300">{title}</p>
          {description && <p className="text-xs text-slate-400">{description}</p>}
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-slate-200 transition", open ? "rotate-180" : "")}
        />
      </button>
      {open && <div>{children}</div>}
    </section>
  );
};

interface ToolChunkListProps {
  chunks: unknown[];
  activeChunkId?: string | null;
  onSelectChunk?: (chunkId: string) => void;
}

export const ToolChunkList = ({ chunks, activeChunkId, onSelectChunk }: ToolChunkListProps) => {
  const normalized = chunks
    .map((chunk) =>
      chunk && typeof chunk === "object" ? (chunk as Record<string, unknown>) : null,
    )
    .filter(Boolean) as Record<string, unknown>[];

  if (normalized.length === 0) {
    return <p className="text-xs text-slate-400">No chunk data returned.</p>;
  }

  return (
    <div className="space-y-3">
      {normalized.map((chunk, index) => {
        const chunkId = (chunk.chunk_id as string) || (chunk.id as string) || `chunk-${index + 1}`;
        const documentId = (chunk.document_id as string) ?? chunk.documentId;
        const order = typeof chunk.order === "number" ? chunk.order : null;
        const score =
          typeof chunk.score === "number"
            ? chunk.score
            : typeof chunk.score === "string"
              ? Number(chunk.score)
              : null;
        const textValue = typeof chunk.text === "string" ? chunk.text : null;
        const metadata =
          chunk.metadata && typeof chunk.metadata === "object"
            ? (chunk.metadata as Record<string, unknown>)
            : null;

        return (
          <article
            key={`${chunkId}-${index}`}
            className={cn(
              "rounded-2xl border border-white/10 bg-slate-950/40 p-4",
              activeChunkId && activeChunkId === chunkId && "border-cyan-400/60 bg-cyan-500/10",
            )}
          >
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-400">
              <span>Chunk {index + 1}</span>
              {Number.isFinite(score) && (
                <span className="font-mono text-cyan-200">Score {Number(score).toFixed(3)}</span>
              )}
            </div>
            {onSelectChunk && chunkId && (
              <button
                type="button"
                onClick={() => onSelectChunk(chunkId)}
                className="mt-2 rounded-full border border-cyan-400/40 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-cyan-200 hover:border-cyan-300/80"
              >
                Trace chunk
              </button>
            )}
            {textValue && <p className="mt-2 text-sm text-slate-100">{truncateText(textValue)}</p>}
            <dl className="mt-3 grid gap-3 text-xs text-slate-300 sm:grid-cols-2">
              {documentId && (
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                    Document
                  </dt>
                  <dd className="font-mono text-slate-100">{documentId}</dd>
                </div>
              )}
              {chunkId && (
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                    Chunk ID
                  </dt>
                  <dd className="font-mono text-slate-100 break-all">{chunkId}</dd>
                </div>
              )}
              {Number.isFinite(order) && (
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Order</dt>
                  <dd className="font-mono text-slate-100">{order}</dd>
                </div>
              )}
            </dl>
            {metadata && Object.keys(metadata).length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Metadata</p>
                <JsonBlock data={metadata} maxHeight={180} className="mt-1" />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};

interface ToolCallBubbleProps {
  label: string;
  variantClass: string;
  args: Record<string, unknown>;
  response: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  className?: string;
  status?: "pending" | "complete";
  footer?: ReactNode;
}

export const formatToolLabel = (label: string): string => {
  if (!label) return "Tool";
  const friendly = label
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
  return friendly || "Tool";
};

const formatKeyLabel = (key: string): string => {
  return key
    .split(/[\s._-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

export const ToolCallBubble = ({
  label,
  variantClass,
  args,
  response,
  rawPayload,
  className,
  status = "complete",
  footer,
}: ToolCallBubbleProps) => {
  const { token } = useAuth();
  const [trace, setTrace] = useState<PipelineTraceResponse | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceChunkId, setTraceChunkId] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const responseMeta: Record<string, unknown> = { ...response };
  const rawChunks = responseMeta.chunks;
  if (Object.prototype.hasOwnProperty.call(responseMeta, "chunks")) {
    delete responseMeta.chunks;
  }
  const chunkList = Array.isArray(rawChunks) ? rawChunks : null;
  const hasResponseMeta = Object.keys(responseMeta).length > 0;

  const chunkPreview = chunkList?.find(
    (chunk) =>
      chunk &&
      typeof chunk === "object" &&
      typeof (chunk as Record<string, unknown>).text === "string",
  ) as Record<string, unknown> | undefined;
  const chunkPreviewText = chunkPreview?.text as string | undefined;
  const summary =
    (typeof args.query === "string" && args.query.trim()) ||
    (typeof responseMeta.query === "string" && responseMeta.query.trim()) ||
    (chunkPreviewText ? truncateText(chunkPreviewText, 120) : null) ||
    "View tool output";
  const [expanded, setExpanded] = useState(false);
  const statusLabel = status === "pending" ? "In progress" : "Complete";
  const statusClass =
    status === "pending"
      ? "border-amber-300/60 text-amber-100"
      : "border-cyan-300/40 text-cyan-200";
  const queryEventId =
    typeof response.query_event_id === "string" ? response.query_event_id : undefined;
  const pipelineRunId =
    typeof response.pipeline_run_id === "string" ? response.pipeline_run_id : undefined;
  const traceAvailable = Boolean(queryEventId || pipelineRunId);

  const loadTrace = async (chunkId?: string | null) => {
    if (!token) {
      return;
    }
    if (!traceAvailable) {
      return;
    }
    setTraceLoading(true);
    try {
      const payload = queryEventId
        ? await fetchQueryEventTrace(queryEventId, token)
        : await fetchPipelineRunTrace(pipelineRunId as string, token);
      setTrace(payload);
      setTraceChunkId(chunkId ?? null);
      setTraceOpen(true);
    } finally {
      setTraceLoading(false);
    }
  };

  return (
    <div className="flex justify-start">
      <div className="group relative max-w-[75%]">
        <div
          className={cn("rounded-2xl border px-4 py-3 text-sm shadow-2xl", variantClass, className)}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-200">Tool Call</p>
              <p className="text-base font-semibold text-white">{formatToolLabel(label)}</p>
            </div>
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em]",
                statusClass,
              )}
            >
              {statusLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-3 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-left text-sm text-slate-200 transition hover:border-cyan-300/40"
            aria-expanded={expanded}
          >
            <div className="flex-1 pr-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Summary</p>
              <p className="line-clamp-2 text-sm text-white">{summary}</p>
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-cyan-200 transition", expanded ? "rotate-180" : "")}
            />
          </button>
          {expanded && (
            <div className="mt-4 space-y-4">
              <ToolPayloadSection title="Invocation" description="Parameters sent with this call.">
                <ToolKeyValueGrid data={args} emptyLabel="No arguments were provided." />
              </ToolPayloadSection>
              {chunkList && chunkList.length > 0 ? (
                <>
                  <ToolPayloadSection
                    title={`Retrieved chunks (${chunkList.length})`}
                    description="Top matches returned by the retriever."
                    collapsible
                    defaultOpen={false}
                  >
                    <ToolChunkList
                      chunks={chunkList}
                      activeChunkId={traceChunkId}
                      onSelectChunk={(chunkId) => loadTrace(chunkId)}
                    />
                  </ToolPayloadSection>
                  {hasResponseMeta && (
                    <ToolPayloadSection title="Response metadata" collapsible defaultOpen={false}>
                      <ToolKeyValueGrid data={responseMeta} emptyLabel="No metadata returned." />
                    </ToolPayloadSection>
                  )}
                  {traceAvailable && (
                    <ToolPayloadSection
                      title="Retrieval trace"
                      description="Replay the retrieval pipeline for this tool call."
                      collapsible
                      defaultOpen={false}
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={traceLoading}
                        onClick={() => loadTrace()}
                        className="mb-3"
                      >
                        {trace ? "Refresh trace" : "Open trace"}
                      </Button>
                      {!trace && (
                        <p className="text-xs text-slate-400">
                          Load the trace to inspect node inputs and outputs.
                        </p>
                      )}
                    </ToolPayloadSection>
                  )}
                </>
              ) : (
                <ToolPayloadSection title="Response" collapsible defaultOpen={false}>
                  <ToolKeyValueGrid
                    data={responseMeta}
                    emptyLabel="Tool did not return structured data."
                  />
                </ToolPayloadSection>
              )}
              <details className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-100">
                <summary className="cursor-pointer text-sm font-semibold text-slate-100">
                  Raw payload
                </summary>
                <JsonBlock data={rawPayload} className="mt-3" />
              </details>
            </div>
          )}
        </div>
        {footer}
      </div>
      <PipelineTraceViewer
        key={trace?.run.id ?? "trace"}
        trace={trace}
        token={token ?? ""}
        isOpen={traceOpen}
        onClose={() => setTraceOpen(false)}
        highlightChunkId={traceChunkId}
      />
    </div>
  );
};
