"use client";

import { Send, Square } from "lucide-react";
import { useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";

import {
  CHAT_INPUT_MAX_HEIGHT,
  CHAT_INPUT_MIN_HEIGHT,
} from "@/components/chat-studio/lib/chat-constants";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
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

const subscribeNever = () => () => {};

/**
 * Whether the send shortcut reads ⌘↵ or Ctrl+↵. Hydration-safe: the tooltip's
 * text sits in the DOM from first paint, so the platform is read through
 * `useSyncExternalStore` (server snapshot: not a Mac) rather than a bare
 * `navigator` sniff at render time.
 */
function useIsMacPlatform(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => /Mac|iP(hone|ad|od)/i.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

/**
 * The composer. Send is the studio's one glowing action — icon-only, inline
 * with the input at the input's own height — and it becomes Stop for as long
 * as a turn is running, so the same control always governs the turn in
 * flight. ⌘/Ctrl+Enter sends from the keyboard; the tooltip names the
 * shortcut for the viewer's platform.
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
  const isMac = useIsMacPlatform();
  const sendShortcut = isMac ? "⌘↵" : "Ctrl+↵";

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (!sending && draft.trim()) {
      onSend();
    }
  };

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
          onKeyDown={handleKeyDown}
          style={{
            minHeight: CHAT_INPUT_MIN_HEIGHT,
            maxHeight: CHAT_INPUT_MAX_HEIGHT,
          }}
        />
        <Tooltip
          content={sending ? (isStopping ? "Stopping" : "Stop") : `Send turn — ${sendShortcut}`}
          side="top"
        >
          <Button
            type="button"
            glow={!sending}
            aria-label={sending ? (isStopping ? "Stopping" : "Stop") : "Send turn"}
            onClick={sending ? onStop : onSend}
            disabled={!sending && !draft.trim()}
            className="shrink-0 p-0"
            style={{ height: CHAT_INPUT_MIN_HEIGHT, width: CHAT_INPUT_MIN_HEIGHT }}
          >
            {sending ? (
              <Square className="h-4 w-4" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </Tooltip>
      </div>
      <p className="mt-1.5 font-mono text-instrument tabular-nums text-meta">
        {draft.length} characters
      </p>
    </div>
  );
};
