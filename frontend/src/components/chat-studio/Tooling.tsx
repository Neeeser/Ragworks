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
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { PulseWire } from "@/components/ui/pulse-wire";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

interface ToolCallBubbleProps {
  label: string;
  args: Record<string, unknown>;
  response: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  status?: "pending" | "complete";
  footer?: ReactNode;
}

/**
 * A tool call in the transcript: what the model asked for, what came back, and
 * the way into the retrieval trace behind it.
 *
 * It spans the pane rather than taking the prose measure — its payload is
 * grids, chunk records and JSON, which are data and not something the reader
 * follows line by line. While the call is still running the wire pulses; when
 * the response lands the pulse stops and the dot settles.
 */
export const ToolCallBubble = ({
  label,
  args,
  response,
  rawPayload,
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
  const pending = status === "pending";
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
    <div className="overflow-hidden rounded-panel border border-hairline bg-surface">
      <div className="flex items-center gap-2 px-3 py-2">
        <InstrumentLabel>Tool call</InstrumentLabel>
        <span className="min-w-0 truncate text-ui font-medium text-primary">
          {formatToolLabel(label)}
        </span>
        <StatusDot
          tone={pending ? "active" : "pos"}
          label={pending ? "Running" : "Complete"}
          className="ml-auto shrink-0"
        />
      </div>
      {pending ? (
        <PulseWire label={`Running ${formatToolLabel(label)}`} className="w-full" />
      ) : null}

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-start justify-between gap-2 border-t border-hairline px-3 py-2 text-left transition-colors duration-80 ease-standard hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
        aria-expanded={expanded}
      >
        <span className="min-w-0">
          <InstrumentLabel>Summary</InstrumentLabel>
          <span className="line-clamp-2 max-w-[66ch] text-ui text-body">{summary}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-140 ease-standard",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-hairline px-3 py-2">
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
                <ToolChunkList chunks={chunkList} onSelectChunk={(chunkId) => openTrace(chunkId)} />
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
            <details className="border-t border-hairline pt-3">
              <summary className="cursor-pointer text-ui font-medium text-body">
                Model tool call
              </summary>
              <JsonBlock data={modelToolCall} className="mt-2" />
            </details>
          )}
          <details className="border-t border-hairline pt-3">
            <summary className="cursor-pointer text-ui font-medium text-body">Raw payload</summary>
            <JsonBlock data={rawPayload} className="mt-2" />
          </details>
        </div>
      )}
      {footer}
    </div>
  );
};
