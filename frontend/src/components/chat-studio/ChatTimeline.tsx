import { Edit3, RotateCcw } from "lucide-react";
import React, { Fragment, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ToolCallBubble } from "@/components/chat-studio/Tooling";
import { Button } from "@/components/ui/button";
import { CollapsibleReasoning } from "@/components/ui/collapsible-reasoning";
import { TypingAnimation } from "@/components/ui/typing-animation";
import { cn } from "@/lib/utils";

import type { ChatEntry } from "./chat-types";
import type { ReasoningTraceSegment, ToolCallTrace } from "@/lib/types";
import type { Components } from "react-markdown";

const TOOL_REASONING_TYPES = new Set([
  "tool_call",
  "tool_use",
  "tool_request",
  "call_tool",
  "function_call",
]);

const isToolReasoningSegment = (segment: ReasoningTraceSegment): boolean => {
  const typeValue = typeof segment.type === "string" ? segment.type.toLowerCase() : "";
  return TOOL_REASONING_TYPES.has(typeValue);
};

const roleVariants: Record<string, string> = {
  user: "border-violet-500/50 bg-violet-600/20 text-violet-50 backdrop-blur-sm",
  assistant: "border-white/20 bg-white/10 text-white backdrop-blur-sm",
  tool: "border-cyan-400/40 bg-cyan-500/15 text-cyan-50 backdrop-blur-sm",
  system: "border-sky-500/30 bg-sky-500/10 text-sky-50",
  reasoning: "border-amber-400/50 bg-amber-500/15 text-amber-50 backdrop-blur-sm",
};

type ChatTimelineProps = {
  collectionLabel: string;
  toolsEnabled: boolean;
  chatEntryOrder: string[];
  chatEntryMap: Map<string, ChatEntry>;
  finalStreamAssistantId: string | null;
  streamEntryKeyMap: Record<string, string>;
  liveToolEvents: ToolCallTrace[];
  selectedSessionId: string | null;
  sending: boolean;
  editingMessageId: string | null;
  editingDraft: string;
  onEditChange: (value: string) => void;
  onEditStart: (messageId: string, content: string) => void;
  onEditCancel: () => void;
  onEditSubmit: () => void;
  onRetryAssistant: (messageId: string) => void;
  onReasoningToggle: (messageId: string, isOpen: boolean) => void;
  markdownComponents: Components;
  samplePrompts: string[];
  onSamplePromptSelect: (value: string) => void;
  liveResponse: string;
  hasLiveText: boolean;
  liveResponseAnimationKey: number;
  activeStreamEntryKey: string | null;
  shouldShowStreamingReasoningBubble: boolean;
  liveReasoningAnimationKey: number;
  liveReasoningBlocks: ReasoningTraceSegment[][];
  liveReasoningPhase: number;
  liveToolOrder: string[];
  liveToolPhaseById: Record<string, number>;
  liveReasoningDisplaySegments: ReasoningTraceSegment[];
  showStreamingBubble: boolean;
};

export function ChatTimeline({
  collectionLabel,
  toolsEnabled,
  chatEntryOrder,
  chatEntryMap,
  finalStreamAssistantId,
  streamEntryKeyMap,
  liveToolEvents,
  selectedSessionId,
  sending,
  editingMessageId,
  editingDraft,
  onEditChange,
  onEditStart,
  onEditCancel,
  onEditSubmit,
  onRetryAssistant,
  onReasoningToggle,
  markdownComponents,
  samplePrompts,
  onSamplePromptSelect,
  liveResponse,
  hasLiveText,
  liveResponseAnimationKey,
  activeStreamEntryKey,
  shouldShowStreamingReasoningBubble,
  liveReasoningAnimationKey,
  liveReasoningBlocks,
  liveReasoningPhase,
  liveToolOrder,
  liveToolPhaseById,
  liveReasoningDisplaySegments,
  showStreamingBubble,
}: ChatTimelineProps) {
  const timelineEntries = chatEntryOrder
    .map((entryId) => chatEntryMap.get(entryId))
    .filter((entry): entry is ChatEntry => Boolean(entry));

  const existingToolIds = useMemo(() => {
    const ids = new Set<string>();
    timelineEntries.forEach((entry) => {
      if (entry.type === "tool-call") {
        const toolId = entry.message.tool_call_id || entry.messageId || entry.id;
        if (toolId) {
          ids.add(toolId);
        }
      }
    });
    return ids;
  }, [timelineEntries]);

  if (timelineEntries.length === 0) {
    const title = toolsEnabled ? collectionLabel : "Chat studio";
    const description = toolsEnabled
      ? "Ask anything about the selected collections and we will cite the chunks that back it up."
      : "Start a conversation now, or enable collection tools in Run settings to ground answers.";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-10 text-center">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Ready to chat</p>
          <h3 className="text-3xl font-semibold text-white">{title}</h3>
          <p className="text-sm text-slate-400">{description}</p>
        </div>
        <div className="grid w-full max-w-3xl gap-3 md:grid-cols-2">
          {samplePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left text-sm text-slate-300 transition hover:border-white/30 hover:text-white"
              onClick={() => onSamplePromptSelect(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const liveStreamBubbleKey = activeStreamEntryKey ?? "typing-indicator";
  const assistantBubbleKey = activeStreamEntryKey
    ? `${activeStreamEntryKey}-assistant`
    : liveStreamBubbleKey;
  const liveReasoningBubbleKey = activeStreamEntryKey
    ? `${activeStreamEntryKey}-reasoning`
    : "live-reasoning-stream";
  const hasStreamingToolReasoning = liveReasoningDisplaySegments.some((segment) =>
    isToolReasoningSegment(segment),
  );
  const shouldShowAssistantSubtitle = hasLiveText && !hasStreamingToolReasoning;
  const liveReasoningSubtitle = hasStreamingToolReasoning
    ? undefined
    : shouldShowAssistantSubtitle
      ? "Assistant reasoning"
      : undefined;

  const hasFinalReasoningForStream =
    Boolean(activeStreamEntryKey) &&
    Boolean(finalStreamAssistantId) &&
    timelineEntries.some(
      (entry) => entry.type === "reasoning" && entry.messageId === finalStreamAssistantId,
    );

  const filteredLiveToolEvents = liveToolEvents.filter(
    (tool) => tool.id && !existingToolIds.has(tool.id),
  );

  const sortedLiveToolEvents = (() => {
    if (filteredLiveToolEvents.length === 0) {
      return [];
    }
    const orderIndex = new Map<string, number>();
    liveToolOrder.forEach((toolId, index) => orderIndex.set(toolId, index));
    return [...filteredLiveToolEvents].sort((a, b) => {
      const aId = a.id || "";
      const bId = b.id || "";
      const aIndex = orderIndex.get(aId) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.get(bId) ?? Number.MAX_SAFE_INTEGER;
      if (aIndex === bIndex) {
        return aId.localeCompare(bId);
      }
      return aIndex - bIndex;
    });
  })();

  const toolEventsByPhase = (() => {
    const grouped = new Map<number, ToolCallTrace[]>();
    sortedLiveToolEvents.forEach((tool) => {
      const toolId = tool.id;
      if (!toolId) return;
      const phaseIndex = liveToolPhaseById[toolId] ?? 0;
      const list = grouped.get(phaseIndex) ?? [];
      list.push(tool);
      grouped.set(phaseIndex, list);
    });
    return grouped;
  })();

  const renderToolBubbles = (phaseIndex: number) => {
    if (!showStreamingBubble) return null;
    const tools = toolEventsByPhase.get(phaseIndex) ?? [];
    if (tools.length === 0) return null;
    return tools.map((tool) => {
      const argsRecord = tool.arguments || {};
      const responseRecord = tool.response || {};
      const rawPayload = {
        arguments: argsRecord,
        response: responseRecord,
        ...(tool.reasoning ? { reasoning: tool.reasoning } : {}),
      };
      const status =
        responseRecord && Object.keys(responseRecord).length > 0 ? "complete" : "pending";
      const bubbleKey = tool.id || `live-tool-${tool.name || "tool"}`;
      return (
        <ToolCallBubble
          key={bubbleKey}
          label={tool.name || "Tool"}
          variantClass={roleVariants.tool}
          args={argsRecord}
          response={responseRecord}
          rawPayload={rawPayload}
          className="chat-bubble chat-bubble-enter"
          status={status}
        />
      );
    });
  };

  const streamingPhaseBubbles =
    shouldShowStreamingReasoningBubble && !hasFinalReasoningForStream && activeStreamEntryKey
      ? Array.from({ length: Math.max(0, liveReasoningPhase) }).flatMap((_, phaseIndex) => {
          const segments = liveReasoningBlocks[phaseIndex] ?? [];
          const reasoningNode =
            segments.length > 0 ? (
              <div
                key={`${activeStreamEntryKey}-reasoning-block-${phaseIndex}`}
                className="flex justify-start"
              >
                <CollapsibleReasoning
                  segments={segments}
                  messageId={`${activeStreamEntryKey}-reasoning-block-${phaseIndex}`}
                  title="Reasoning"
                  subtitle={phaseIndex === 0 ? liveReasoningSubtitle : undefined}
                  isAutoOpen={false}
                  preventAutoClose
                  onManualToggle={onReasoningToggle}
                  className={cn(
                    "chat-bubble chat-bubble-enter max-w-[75%]",
                    roleVariants.reasoning,
                  )}
                />
              </div>
            ) : null;
          const toolNodes = renderToolBubbles(phaseIndex);
          return [reasoningNode, toolNodes].flat().filter(Boolean) as React.ReactNode[];
        })
      : [];

  const streamingCurrentReasoningBubble =
    shouldShowStreamingReasoningBubble &&
    !hasFinalReasoningForStream &&
    liveReasoningDisplaySegments.length > 0 ? (
      <div
        key={liveReasoningBubbleKey}
        className="flex justify-start"
        data-live-reasoning-key={liveReasoningAnimationKey}
      >
        <CollapsibleReasoning
          segments={liveReasoningDisplaySegments}
          messageId="live-reasoning"
          title="Reasoning"
          subtitle={liveReasoningSubtitle}
          isAutoOpen={false}
          preventAutoClose
          onManualToggle={onReasoningToggle}
          className={cn(
            "live-stream-reasoning chat-bubble chat-bubble-enter max-w-[75%]",
            roleVariants.reasoning,
          )}
        />
      </div>
    ) : null;

  const assistantTypingBubble = showStreamingBubble ? (
    <div key={assistantBubbleKey} className="flex justify-start">
      <div className="group relative max-w-[75%]">
        <div
          className={cn(
            "live-stream-text chat-bubble chat-bubble-enter rounded-2xl border px-4 py-3 text-sm shadow-2xl",
            roleVariants.assistant,
          )}
          data-live-stream-key={liveResponseAnimationKey}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">ASSISTANT</p>
          </div>
          {showStreamingBubble && hasLiveText ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {liveResponse}
            </ReactMarkdown>
          ) : (
            <TypingAnimation />
          )}
        </div>
      </div>
    </div>
  ) : null;

  const messageBubbles = timelineEntries.map((entry) => {
    if (entry.type === "tool-call") {
      const toolKey =
        (entry.message.tool_call_id && streamEntryKeyMap[entry.message.tool_call_id]) ||
        entry.message.tool_call_id ||
        entry.messageId ||
        entry.id;
      return (
        <Fragment key={toolKey}>
          <ToolCallBubble
            label={entry.label}
            variantClass={roleVariants.tool}
            args={entry.args}
            response={entry.response}
            rawPayload={entry.rawPayload}
            className="chat-bubble"
          />
        </Fragment>
      );
    }

    if (entry.type === "reasoning") {
      const mappedKey =
        entry.messageId && streamEntryKeyMap[entry.messageId]
          ? `${streamEntryKeyMap[entry.messageId]}-reasoning`
          : null;
      const bubbleKey = mappedKey || entry.id;
      return (
        <div key={bubbleKey} className="flex justify-start">
          <CollapsibleReasoning
            segments={entry.segments}
            messageId={entry.id}
            title={entry.title}
            subtitle={entry.subtitle}
            isAutoOpen={false}
            preventAutoClose
            onManualToggle={onReasoningToggle}
            className={cn("chat-bubble max-w-[75%]", roleVariants.reasoning)}
          />
        </div>
      );
    }

    const variant = roleVariants[entry.type] ?? roleVariants.system;
    const isUser = entry.type === "user";
    const isAssistant = entry.type === "assistant";
    const showActions = (isUser || isAssistant) && !!selectedSessionId;
    const alignClass = isUser ? "justify-end" : "justify-start";
    const usage = entry.message.usage;
    const headerLabel = entry.message.role === "user" ? "You" : entry.message.role.toUpperCase();
    const bubbleKey = entry.id;

    return (
      <div key={bubbleKey} className={cn("flex", alignClass)}>
        <div className="group relative max-w-[75%]">
          <div
            className={cn(
              "chat-bubble rounded-2xl border px-4 py-3 text-sm shadow-2xl transition",
              variant,
            )}
            data-chat-role={entry.type}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.3em] text-white/70">
                {headerLabel}
                {entry.message.tool_name ? ` • ${entry.message.tool_name}` : ""}
              </p>
              {showActions && (
                <div className="flex items-center gap-2 text-[11px] text-white/80">
                  {isUser && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 hover:border-white/60"
                      onClick={() => onEditStart(entry.message.id, entry.message.content)}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}
                  {isAssistant && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 hover:border-white/60"
                      onClick={() => onRetryAssistant(entry.message.id)}
                      disabled={sending}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
            {isUser && editingMessageId === entry.message.id ? (
              <div className="space-y-2">
                <textarea
                  className="min-h-[120px] w-full rounded-2xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
                  value={editingDraft}
                  onChange={(event) => onEditChange(event.target.value)}
                />
                <div className="flex items-center gap-3">
                  <Button size="sm" onClick={onEditSubmit} loading={sending}>
                    Update & rerun
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={onEditCancel}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : isAssistant ? (
              <div className="space-y-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {entry.content}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{entry.content}</p>
            )}
          </div>
          {usage && (
            <div className="pointer-events-none absolute left-0 right-0 top-full mt-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-300/70">
                {usage.total_tokens != null && (
                  <span>{usage.total_tokens.toLocaleString()} tok</span>
                )}
                {usage.prompt_tokens != null && (
                  <span>{usage.prompt_tokens.toLocaleString()} in</span>
                )}
                {usage.completion_tokens != null && (
                  <span>{usage.completion_tokens.toLocaleString()} out</span>
                )}
                {usage.reasoning_tokens != null && usage.reasoning_tokens > 0 && (
                  <span>{usage.reasoning_tokens.toLocaleString()} reasoning</span>
                )}
                {usage.cost != null && (
                  <span className="text-slate-100/80">
                    $
                    {usage.cost.toLocaleString(undefined, {
                      minimumFractionDigits: 4,
                      maximumFractionDigits: 6,
                    })}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  });

  const streamingBubbles: React.ReactNode[] = [];
  if (streamingPhaseBubbles.length > 0) streamingBubbles.push(...streamingPhaseBubbles);
  if (streamingCurrentReasoningBubble) streamingBubbles.push(streamingCurrentReasoningBubble);
  const trailingTools = renderToolBubbles(liveReasoningPhase);
  if (trailingTools) {
    streamingBubbles.push(...(Array.isArray(trailingTools) ? trailingTools : [trailingTools]));
  }
  if (assistantTypingBubble) streamingBubbles.push(assistantTypingBubble);
  return streamingBubbles.length > 0 ? [...messageBubbles, ...streamingBubbles] : messageBubbles;
}
