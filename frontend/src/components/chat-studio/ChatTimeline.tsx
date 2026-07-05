import React, { memo, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { isToolReasoningSegment } from "@/components/chat-studio/chat-entry-helpers";
import { EmptyTimelineState } from "@/components/chat-studio/timeline/EmptyTimelineState";
import { MessageEntry } from "@/components/chat-studio/timeline/MessageEntry";
import {
  getReasoningEntryKey,
  ReasoningEntry,
} from "@/components/chat-studio/timeline/ReasoningEntry";
import { roleVariants } from "@/components/chat-studio/timeline/timeline-constants";
import {
  getToolTraceEntryKey,
  ToolTraceEntry,
} from "@/components/chat-studio/timeline/ToolTraceEntry";
import { ToolCallBubble } from "@/components/chat-studio/Tooling";
import { CollapsibleReasoning } from "@/components/ui/collapsible-reasoning";
import { TypingAnimation } from "@/components/ui/typing-animation";
import { cn } from "@/lib/utils";

import type { ChatEntry } from "./chat-types";
import type { ReasoningTraceSegment, ToolCallTrace } from "@/lib/types";
import type { Components } from "react-markdown";

type ChatTimelineProps = {
  modelLabel: string;
  onModelSelect: () => void;
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
  onBranchMessage: (messageId: string) => void;
  markdownComponents: Components;
  overrideSections: Array<{
    id: string;
    label: string;
  }>;
  onOverrideSelect: (sectionId: string) => void;
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
  branchedFromSessionId: string | null;
  branchedFromSessionTitle: string | null;
  branchedFromMessageId: string | null;
  branchedFromOrigin: "edit" | "manual";
  onNavigateToSession: (sessionId: string) => void;
};

function ChatTimelineComponent({
  modelLabel,
  onModelSelect,
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
  onBranchMessage,
  markdownComponents,
  overrideSections,
  onOverrideSelect,
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
  branchedFromSessionId,
  branchedFromSessionTitle,
  branchedFromMessageId,
  branchedFromOrigin,
  onNavigateToSession,
}: ChatTimelineProps) {
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editingMessageId || !editTextareaRef.current) {
      return;
    }

    const textarea = editTextareaRef.current;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [editingDraft, editingMessageId]);

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
    if (!selectedSessionId) {
      return (
        <EmptyTimelineState
          modelLabel={modelLabel}
          onModelSelect={onModelSelect}
          overrideSections={overrideSections}
          onOverrideSelect={onOverrideSelect}
        />
      );
    }
    return <div className="h-full" />;
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
      /* c8 ignore start -- tool ids are required for ordering */
      const aId = a.id || "";
      const bId = b.id || "";
      /* c8 ignore stop */
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
      /* c8 ignore next -- tool ids are required for streaming grouping */
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
      /* c8 ignore next -- fallback key only applies when tool ids are missing */
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
      return (
        <ToolTraceEntry
          key={getToolTraceEntryKey(entry, streamEntryKeyMap)}
          entry={entry}
          streamEntryKeyMap={streamEntryKeyMap}
          branchedFromMessageId={branchedFromMessageId}
          branchedFromSessionId={branchedFromSessionId}
          branchedFromSessionTitle={branchedFromSessionTitle}
          onNavigateToSession={onNavigateToSession}
        />
      );
    }

    if (entry.type === "reasoning") {
      return <ReasoningEntry key={getReasoningEntryKey(entry, streamEntryKeyMap)} entry={entry} />;
    }

    return (
      <MessageEntry
        key={entry.id}
        entry={entry}
        selectedSessionId={selectedSessionId}
        sending={sending}
        editingMessageId={editingMessageId}
        editingDraft={editingDraft}
        editTextareaRef={editTextareaRef}
        onEditChange={onEditChange}
        onEditStart={onEditStart}
        onEditCancel={onEditCancel}
        onEditSubmit={onEditSubmit}
        onRetryAssistant={onRetryAssistant}
        onBranchMessage={onBranchMessage}
        markdownComponents={markdownComponents}
        branchedFromSessionId={branchedFromSessionId}
        branchedFromSessionTitle={branchedFromSessionTitle}
        branchedFromMessageId={branchedFromMessageId}
        branchedFromOrigin={branchedFromOrigin}
        onNavigateToSession={onNavigateToSession}
      />
    );
  });

  const streamingBubbles: React.ReactNode[] = [];
  if (streamingPhaseBubbles.length > 0) streamingBubbles.push(...streamingPhaseBubbles);
  if (streamingCurrentReasoningBubble) streamingBubbles.push(streamingCurrentReasoningBubble);
  const trailingTools = renderToolBubbles(liveReasoningPhase);
  if (trailingTools) {
    streamingBubbles.push(...trailingTools);
  }
  if (assistantTypingBubble) streamingBubbles.push(assistantTypingBubble);
  return streamingBubbles.length > 0 ? [...messageBubbles, ...streamingBubbles] : messageBubbles;
}

export const ChatTimeline = memo(ChatTimelineComponent);
