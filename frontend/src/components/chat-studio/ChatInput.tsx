"use client";

import { ImagePlus, Send, Square, X } from "lucide-react";
import { useRef, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";

import {
  CHAT_INPUT_MAX_HEIGHT,
  CHAT_INPUT_MIN_HEIGHT,
} from "@/components/chat-studio/lib/chat-constants";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { IMAGE_FILE_ACCEPT } from "@/lib/image-files";
import { cn } from "@/lib/utils";

import type { DraftAttachment } from "@/components/chat-studio/hooks/use-chat-attachments";

interface ChatInputProps {
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  isStopping: boolean;
  onSend: () => void;
  onStop: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  attachments: DraftAttachment[];
  attachmentError: string | null;
  onAttachFiles: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  /** Set when the selected model states no image input; names the reason. */
  attachDisabledReason?: string | null;
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
 * shortcut for the viewer's platform. Attached images sit as thumbnails
 * above the input until the turn sends them.
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
  attachments,
  attachmentError,
  onAttachFiles,
  onRemoveAttachment,
  attachDisabledReason,
}: ChatInputProps) => {
  const isMac = useIsMacPlatform();
  const sendShortcut = isMac ? "⌘↵" : "Ctrl+↵";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canSend = Boolean(draft.trim() || attachments.length > 0);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (!sending && canSend) {
      onSend();
    }
  };

  return (
    <div className="shrink-0 border-t border-hairline p-3">
      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="relative inline-flex">
              {/* Object URLs are local previews next/image cannot accept. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.previewUrl}
                alt={attachment.name}
                className="h-14 w-14 rounded-control border border-hairline object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => onRemoveAttachment(attachment.id)}
                className="absolute -right-1.5 -top-1.5 rounded-full border border-hairline bg-surface-strong p-0.5 text-muted transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) onAttachFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Tooltip content={attachDisabledReason ?? "Attach images"} side="top">
          <Button
            type="button"
            variant="ghost"
            aria-label="Attach images"
            disabled={sending || Boolean(attachDisabledReason)}
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 p-0"
            style={{ height: CHAT_INPUT_MIN_HEIGHT, width: CHAT_INPUT_MIN_HEIGHT }}
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
          </Button>
        </Tooltip>
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
            disabled={!sending && !canSend}
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
        {attachmentError ? (
          <span className="text-data-neg">{attachmentError}</span>
        ) : (
          `${draft.length} characters`
        )}
      </p>
    </div>
  );
};
