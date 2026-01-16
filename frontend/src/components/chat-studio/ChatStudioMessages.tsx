"use client";

import { ArrowDown } from "lucide-react";

import { ChatInput } from "@/components/chat-studio/ChatInput";
import { ChatTimeline } from "@/components/chat-studio/ChatTimeline";

import type { ComponentProps, RefObject, UIEventHandler } from "react";

type ChatStudioMessagesProps = {
  messagesContainerRef: RefObject<HTMLDivElement>;
  endRef: RefObject<HTMLDivElement>;
  onScroll: UIEventHandler<HTMLDivElement>;
  showFollowButton: boolean;
  onFollow: () => void;
  timelineProps: ComponentProps<typeof ChatTimeline>;
  inputProps: ComponentProps<typeof ChatInput>;
};

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
    <div className="flex h-full flex-col min-h-0 overflow-hidden">
      <div
        ref={messagesContainerRef}
        onScroll={onScroll}
        className="relative flex-1 min-h-0 overflow-y-auto px-16 py-6 scroll-smooth !overflow-anchor-none"
        style={{ overflowAnchor: "none" }}
      >
        <div className="flex h-full flex-col gap-4">
          <ChatTimeline {...timelineProps} />
          <div ref={endRef} />
        </div>
      </div>
      {showFollowButton && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[9rem] flex justify-center">
          <button
            type="button"
            onClick={onFollow}
            aria-label="Scroll to latest message"
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white opacity-90 shadow-2xl backdrop-blur-sm transition hover:bg-black/80 hover:opacity-100"
          >
            <ArrowDown className="h-5 w-5" />
          </button>
        </div>
      )}
      <ChatInput {...inputProps} />
    </div>
  );
}
