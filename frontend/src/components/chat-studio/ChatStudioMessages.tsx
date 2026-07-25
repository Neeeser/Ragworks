"use client";

import { ArrowDown } from "lucide-react";

import { ChatInput } from "@/components/chat-studio/ChatInput";
import { ChatTimeline } from "@/components/chat-studio/ChatTimeline";
import { Button } from "@/components/ui/button";

import type { ComponentProps, RefObject, UIEventHandler } from "react";

type ChatStudioMessagesProps = {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  showFollowButton: boolean;
  onFollow: () => void;
  timelineProps: ComponentProps<typeof ChatTimeline>;
  inputProps: ComponentProps<typeof ChatInput>;
};

/**
 * The centre pane: the transcript's own scroll region with the composer pinned
 * under it, and the follow-the-stream control that appears only once the user
 * has scrolled away from the newest turn.
 */
export function ChatStudioMessages({
  messagesContainerRef,
  endRef,
  onScroll,
  showFollowButton,
  onFollow,
  timelineProps,
  inputProps,
}: ChatStudioMessagesProps) {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div
        ref={messagesContainerRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto scroll-smooth p-4"
        style={{ overflowAnchor: "none" }}
      >
        <div className="flex h-full flex-col gap-4">
          <ChatTimeline {...timelineProps} />
          <div ref={endRef} />
        </div>
      </div>
      {showFollowButton && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={onFollow}
            aria-label="Scroll to latest message"
            className="pointer-events-auto bg-canvas-raised shadow-elevation-2"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            Latest
          </Button>
        </div>
      )}
      <ChatInput {...inputProps} />
    </div>
  );
}
