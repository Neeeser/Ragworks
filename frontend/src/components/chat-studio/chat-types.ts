import type { ChatMessage, ReasoningTraceSegment } from "@/lib/types";

export type ReasoningSource = "assistant" | "tool";

interface ChatEntryBase {
  id: string;
  messageId?: string;
  createdAt: string;
}

export interface ChatMessageEntry extends ChatEntryBase {
  type: "user" | "assistant" | "system";
  message: ChatMessage;
  content: string;
}

export interface ChatReasoningEntry extends ChatEntryBase {
  type: "reasoning";
  source: ReasoningSource;
  title: string;
  subtitle?: string;
  segments: ReasoningTraceSegment[];
  relatedToolLabel?: string;
}

export interface ChatToolEntry extends ChatEntryBase {
  type: "tool-call";
  message: ChatMessage;
  label: string;
  args: Record<string, unknown>;
  response: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  toolId?: string;
}

export type ChatEntry = ChatMessageEntry | ChatReasoningEntry | ChatToolEntry;
