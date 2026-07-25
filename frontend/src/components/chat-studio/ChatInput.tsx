"use client";

import { Send, Square } from "lucide-react";
import { type RefObject } from "react";

import {
  CHAT_INPUT_MAX_HEIGHT,
  CHAT_INPUT_MIN_HEIGHT,
} from "@/components/chat-studio/lib/chat-constants";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  isStopping: boolean;
  onSend: () => void;
  onStop: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
}

/**
 * The composer. Send is the studio's one glowing action — the primary thing a
 * user does here — and it becomes Stop for as long as a turn is running, so the
 * same control always governs the turn in flight.
 */
export const ChatInput = ({
  draft,
  setDraft,
  sending,
  isStopping,
  onSend,
  onStop,
  inputRef,
  placeholder = "Ask anything…",
}: ChatInputProps) => {
  return (
    <div className="shrink-0 border-t border-hairline p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          className={cn(inputClass, "resize-none leading-relaxed")}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          style={{
            minHeight: CHAT_INPUT_MIN_HEIGHT,
            maxHeight: CHAT_INPUT_MAX_HEIGHT,
          }}
        />
        <Button
          type="button"
          glow={!sending}
          onClick={sending ? onStop : onSend}
          disabled={!sending && !draft.trim()}
        >
          {sending ? (
            <>
              <Square className="h-3.5 w-3.5" aria-hidden />
              {isStopping ? "Stopping..." : "Stop"}
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5" aria-hidden />
              Send turn
            </>
          )}
        </Button>
      </div>
      <p className="mt-1.5 font-mono text-instrument tabular-nums text-meta">
        {draft.length} characters
      </p>
    </div>
  );
};
