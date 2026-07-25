import { CollapsibleReasoning } from "@/components/ui/collapsible-reasoning";

import type { ChatReasoningEntry } from "@/components/chat-studio/lib/chat-types";

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
  <CollapsibleReasoning
    segments={entry.segments}
    messageId={entry.id}
    title={entry.title}
    subtitle={entry.subtitle}
    isAutoOpen={false}
    preventAutoClose
  />
);
