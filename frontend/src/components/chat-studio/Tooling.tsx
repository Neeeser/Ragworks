"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  formatToolLabel,
  JsonBlock,
  ToolChunkList,
  ToolKeyValueGrid,
  ToolPayloadSection,
  truncateText,
} from "@/components/chat-studio/ToolPayloadPrimitives";
import { PipelineTraceViewer } from "@/components/traces/PipelineTraceViewer";
import { Button } from "@/components/ui/button";
import { fetchPipelineRunTrace, fetchQueryEventTrace } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import type { PipelineTraceResponse } from "@/lib/types";

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
  const [traceError, setTraceError] = useState<string | null>(null);
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
        ? await fetchQueryEventTrace(token, queryEventId)
        : await fetchPipelineRunTrace(token, pipelineRunId as string);
      setTrace(payload);
      setTraceChunkId(chunkId ?? null);
      setTraceOpen(true);
      setTraceError(null);
    } catch (error) {
      setTraceError(getErrorMessage(error, "Unable to load the retrieval trace."));
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
                      {traceError && <p className="text-xs text-red-300">{traceError}</p>}
                      {!trace && !traceError && (
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
        isOpen={traceOpen}
        onClose={() => setTraceOpen(false)}
        highlightChunkId={traceChunkId}
      />
    </div>
  );
};
