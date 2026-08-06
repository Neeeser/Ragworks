import { BranchedFromBanner } from "@/components/chat-studio/timeline/BranchedFromBanner";
import { ToolCallBubble } from "@/components/chat-studio/Tooling";

import type { ChatToolEntry } from "@/components/chat-studio/lib/chat-types";

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
    <div className="flex flex-col gap-1.5">
      <ToolCallBubble
        label={entry.label}
        args={entry.args}
        response={entry.response}
        rawPayload={entry.rawPayload}
        collectionId={
          typeof entry.rawPayload.collection_id === "string"
            ? entry.rawPayload.collection_id
            : undefined
        }
      />
      {shouldShowBranchedFrom ? (
        <BranchedFromBanner
          className="flex items-center gap-1.5"
          branchedFromSessionId={branchedFromSessionId}
          branchedFromLabel={branchedFromLabel}
          onNavigateToSession={onNavigateToSession}
        />
      ) : null}
    </div>
  );
};
