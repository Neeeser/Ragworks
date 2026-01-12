import { Edit3, GitBranch, RotateCcw } from "lucide-react";
import React, { Fragment, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ToolCallBubble } from "@/components/chat-studio/Tooling";
import { Button } from "@/components/ui/button";
import { CollapsibleReasoning } from "@/components/ui/collapsible-reasoning";
import { TypingAnimation } from "@/components/ui/typing-animation";
import { cn } from "@/lib/utils";

import type { ChatEntry } from "./chat-types";
import type { ReasoningTraceSegment, ToolCallTrace, UsageBreakdown } from "@/lib/types";
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

const UsageInline = ({ usage }: { usage: UsageBreakdown }) => (
  <>
    {usage.total_tokens != null && <span>{usage.total_tokens.toLocaleString()} tok</span>}
    {usage.prompt_tokens != null && <span>{usage.prompt_tokens.toLocaleString()} in</span>}
    {usage.completion_tokens != null && <span>{usage.completion_tokens.toLocaleString()} out</span>}
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
  </>
);

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
  onReasoningToggle: (messageId: string, isOpen: boolean) => void;
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

export function ChatTimeline({
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
  onReasoningToggle,
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
  const renderBranchRow = (messageId: string, usage?: UsageBreakdown | null) => (
    <div className="absolute left-0 right-0 top-full mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-300/70 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      {usage && <UsageInline usage={usage} />}
      <button
        type="button"
        className="pointer-events-auto inline-flex items-center justify-center rounded-full border border-white/20 p-1 text-white/80 hover:border-white/60"
        onClick={() => onBranchMessage(messageId)}
        disabled={sending}
        aria-label="Branch chat"
      >
        <GitBranch className="h-3.5 w-3.5" />
      </button>
    </div>
  );

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
        <div className="flex h-full flex-col items-center justify-center gap-10 text-center">
          <div className="flex w-full max-w-md flex-col items-center">
            <button
              type="button"
              onClick={onModelSelect}
              className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-left text-xs text-slate-300 transition hover:border-white/30 hover:text-white"
            >
              <span className="shrink-0 text-[10px] uppercase tracking-[0.35em] text-slate-500">
                Model
              </span>
              <span className="min-w-0 truncate text-sm font-semibold text-white">
                {modelLabel}
              </span>
            </button>
          </div>
          <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/70 via-slate-950/40 to-cyan-950/30 p-6 text-left shadow-[0_30px_80px_-50px_rgba(56,189,248,0.35)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Overrides</p>
                <h4 className="text-lg font-semibold text-white">Run settings active</h4>
                <p className="text-sm text-slate-400">Tap a section to open it in Run settings.</p>
              </div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.4em] text-cyan-300">
                <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.85)]" />
                Live
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {overrideSections.length > 0 ? (
                overrideSections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onOverrideSelect(section.id)}
                    className="rounded-full border border-cyan-200/30 bg-cyan-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-400/20"
                  >
                    {section.label}
                  </button>
                ))
              ) : (
                <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  No overrides yet
                </span>
              )}
            </div>
          </div>
        </div>
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
          <div className="max-w-[75%]">
            <CollapsibleReasoning
              segments={entry.segments}
              messageId={entry.id}
              title={entry.title}
              subtitle={entry.subtitle}
              isAutoOpen={false}
              preventAutoClose
              onManualToggle={onReasoningToggle}
              className={cn("chat-bubble", roleVariants.reasoning)}
            />
          </div>
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

    const branchFooter = selectedSessionId ? renderBranchRow(entry.message.id, usage) : null;
    const hasBranchFooter = Boolean(branchFooter);

    const shouldShowBranchedFrom =
      Boolean(branchedFromSessionId) &&
      Boolean(branchedFromMessageId) &&
      entry.message.source_message_id === branchedFromMessageId;
    const branchedFromLabel = branchedFromSessionTitle || "Original chat";
    const branchBanner = shouldShowBranchedFrom ? (
      <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-300/80">
        <span className="text-[9px] uppercase tracking-[0.35em] text-slate-500">Branched from</span>
        {branchedFromSessionId ? (
          <button
            type="button"
            onClick={() => onNavigateToSession(branchedFromSessionId)}
            className="text-slate-100 underline-offset-4 hover:underline"
          >
            {branchedFromLabel}
          </button>
        ) : (
          <span>{branchedFromLabel}</span>
        )}
      </div>
    ) : null;
    const shouldShowBannerAbove =
      shouldShowBranchedFrom && entry.message.role === "user" && branchedFromOrigin === "edit";
    const shouldShowBannerBelow = shouldShowBranchedFrom && !shouldShowBannerAbove;

    const isEditing = isUser && editingMessageId === entry.message.id;
    const editHighlight = isEditing
      ? "border-violet-300/80 bg-violet-500/25 shadow-[0_0_0_1px_rgba(196,181,253,0.35)]"
      : null;

    return (
      <div key={bubbleKey} className={cn("flex", alignClass, hasBranchFooter && "mb-5")}>
        <div className={cn("group relative max-w-[75%]", isEditing && "w-full")}>
          {shouldShowBannerAbove ? branchBanner : null}
          <div
            className={cn(
              "chat-bubble rounded-2xl border px-4 py-3 text-sm shadow-2xl transition",
              variant,
              editHighlight,
              isEditing && "w-full",
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
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  ref={editTextareaRef}
                  className="min-h-[64px] w-full resize-none overflow-hidden rounded-xl bg-violet-500/15 px-4 py-3 text-sm leading-relaxed text-white outline-none"
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
          {shouldShowBannerBelow ? branchBanner : null}
          {branchFooter}
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
