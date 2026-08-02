"use client";

import { useState } from "react";

import { Markdown } from "@/components/ui/markdown";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

/** One message of a chat payload, in the order it is (or would be) sent. */
export interface StackMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Optional note beside the role — what this message is ("instructions"). */
  note?: string;
}

type MessageView = "rendered" | "raw";

interface MessageStackProps {
  messages: StackMessage[];
  /** Names the payload for screen readers and the view toggle. */
  label: string;
  className?: string;
  defaultView?: MessageView;
}

const ROLE_INK: Record<StackMessage["role"], string> = {
  system: "text-accent-violet",
  user: "text-accent-cyan",
  assistant: "text-body",
};

/**
 * A chat payload as role-labelled message blocks with a Rendered ⇄ Raw
 * toggle — rendered markdown to read formatting, raw mono source to read
 * exactly what travels. Every block shows its complete text: message
 * content is never ellipsized or capped here (scrolling belongs to the
 * pane that hosts the stack).
 */
export function MessageStack({
  messages,
  label,
  className,
  defaultView = "rendered",
}: MessageStackProps) {
  const [view, setView] = useState<MessageView>(defaultView);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-instrument font-medium text-muted">{label}</span>
        <SegmentedControl<MessageView>
          aria-label={`${label} view`}
          value={view}
          onChange={setView}
          options={[
            { id: "rendered", label: "Rendered" },
            { id: "raw", label: "Raw" },
          ]}
        />
      </div>
      <ol className="space-y-2">
        {messages.map((message, index) => (
          <li
            key={`${message.role}-${index}`}
            className="rounded-control border border-hairline bg-surface"
          >
            <div className="flex items-baseline gap-2 border-b border-hairline px-2 py-1">
              <span className={cn("font-mono text-instrument", ROLE_INK[message.role])}>
                {message.role}
              </span>
              {message.note && <span className="text-instrument text-meta">{message.note}</span>}
            </div>
            <div className="p-2">
              {view === "rendered" ? (
                <Markdown className="max-w-[72ch]">{message.content}</Markdown>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-instrument text-body">
                  {message.content}
                </pre>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
