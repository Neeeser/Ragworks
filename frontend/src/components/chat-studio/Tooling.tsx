"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  formatToolLabel,
  JsonBlock,
  ToolChunkList,
  ToolKeyValueGrid,
  ToolPayloadSection,
  truncateText,
} from "@/components/chat-studio/ToolPayloadPrimitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  const router = useRouter();
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
      ? "border-data-warn/60 text-data-warn"
      : "border-accent-cyan/40 text-accent-cyan";
  const queryEventId =
    typeof response.query_event_id === "string" ? response.query_event_id : undefined;
  const pipelineRunId =
    typeof response.pipeline_run_id === "string" ? response.pipeline_run_id : undefined;
  const traceAvailable = Boolean(queryEventId || pipelineRunId);
  const modelToolCall = rawPayload.model_tool_call;
  const hasModelToolCall = modelToolCall !== undefined;

  const openTrace = (chunkId?: string | null) => {
    if (!traceAvailable) {
      return;
    }
    const chunkParam = chunkId ? `?chunk=${encodeURIComponent(chunkId)}` : "";
    const path = queryEventId ? `/traces/queries/${queryEventId}` : `/traces/runs/${pipelineRunId}`;
    router.push(`${path}${chunkParam}`);
  };

  return (
    <div className="flex justify-start">
      <div className="group relative max-w-[75%]">
        <div
          className={cn("rounded-2xl border px-4 py-3 text-sm shadow-2xl", variantClass, className)}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-cyan">
                Tool Call
              </p>
              <p className="text-base font-semibold text-primary">{formatToolLabel(label)}</p>
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
            className="mt-3 flex w-full items-center justify-between rounded-2xl border border-hairline bg-surface px-4 py-2 text-left text-sm text-body transition hover:border-accent-cyan/40"
            aria-expanded={expanded}
          >
            <div className="flex-1 pr-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">Summary</p>
              <p className="line-clamp-2 text-sm text-primary">{summary}</p>
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-accent-cyan transition", expanded ? "rotate-180" : "")}
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
                      onSelectChunk={(chunkId) => openTrace(chunkId)}
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
                      description="Step through the retrieval pipeline for this tool call."
                      collapsible
                      defaultOpen={false}
                    >
                      <Button size="sm" variant="secondary" onClick={() => openTrace()}>
                        Open trace
                      </Button>
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
              {hasModelToolCall && (
                <details className="rounded-2xl border border-hairline bg-surface p-3 text-xs text-body">
                  <summary className="cursor-pointer text-sm font-semibold text-body">
                    Model tool call
                  </summary>
                  <JsonBlock data={modelToolCall} className="mt-3" />
                </details>
              )}
              <details className="rounded-2xl border border-hairline bg-surface p-3 text-xs text-body">
                <summary className="cursor-pointer text-sm font-semibold text-body">
                  Raw payload
                </summary>
                <JsonBlock data={rawPayload} className="mt-3" />
              </details>
            </div>
          )}
        </div>
        {footer}
      </div>
    </div>
  );
};
