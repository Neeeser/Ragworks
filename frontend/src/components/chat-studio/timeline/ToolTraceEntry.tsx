import { BranchedFromBanner } from "@/components/chat-studio/timeline/BranchedFromBanner";
import { roleVariants } from "@/components/chat-studio/timeline/timeline-constants";
import { ToolCallBubble } from "@/components/chat-studio/Tooling";

import type { ChatToolEntry } from "@/components/chat-studio/chat-types";

interface ToolTraceEntryProps {
  entry: ChatToolEntry;
  streamEntryKeyMap: Record<string, string>;
  branchedFromMessageId: string | null;
  branchedFromSessionId: string | null;
  branchedFromSessionTitle: string | null;
  onNavigateToSession: (sessionId: string) => void;
}

export const getToolTraceEntryKey = (
  entry: ChatToolEntry,
  streamEntryKeyMap: Record<string, string>,
): string =>
  (entry.message.tool_call_id && streamEntryKeyMap[entry.message.tool_call_id]) ||
  entry.message.tool_call_id ||
  entry.messageId ||
  entry.id;

export const ToolTraceEntry = ({
  entry,
  branchedFromMessageId,
  branchedFromSessionId,
  branchedFromSessionTitle,
  onNavigateToSession,
}: ToolTraceEntryProps) => {
  const shouldShowBranchedFrom =
    Boolean(branchedFromMessageId) && entry.message.source_message_id === branchedFromMessageId;
  const branchedFromLabel = branchedFromSessionTitle || "Original chat";

  return (
    <div className="flex flex-col">
      <ToolCallBubble
        label={entry.label}
        variantClass={roleVariants.tool}
        args={entry.args}
        response={entry.response}
        rawPayload={entry.rawPayload}
        className="chat-bubble"
      />
      {shouldShowBranchedFrom ? (
        <div className="flex justify-start">
          <BranchedFromBanner
            className="mt-2 flex items-center gap-2 text-[11px] text-slate-300/80"
            branchedFromSessionId={branchedFromSessionId}
            branchedFromLabel={branchedFromLabel}
            onNavigateToSession={onNavigateToSession}
          />
        </div>
      ) : null}
    </div>
  );
};
