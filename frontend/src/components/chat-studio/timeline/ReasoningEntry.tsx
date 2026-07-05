import { roleVariants } from "@/components/chat-studio/timeline/timeline-constants";
import { CollapsibleReasoning } from "@/components/ui/collapsible-reasoning";
import { cn } from "@/lib/utils";

import type { ChatReasoningEntry } from "@/components/chat-studio/chat-types";

interface ReasoningEntryProps {
  entry: ChatReasoningEntry;
}

export const getReasoningEntryKey = (
  entry: ChatReasoningEntry,
  streamEntryKeyMap: Record<string, string>,
): string => {
  const mappedKey =
    entry.messageId && streamEntryKeyMap[entry.messageId]
      ? `${streamEntryKeyMap[entry.messageId]}-reasoning`
      : null;
  return mappedKey || entry.id;
};

export const ReasoningEntry = ({ entry }: ReasoningEntryProps) => (
  <div className="flex justify-start">
    <div className="max-w-[75%]">
      <CollapsibleReasoning
        segments={entry.segments}
        messageId={entry.id}
        title={entry.title}
        subtitle={entry.subtitle}
        isAutoOpen={false}
        preventAutoClose
        className={cn("chat-bubble", roleVariants.reasoning)}
      />
    </div>
  </div>
);
