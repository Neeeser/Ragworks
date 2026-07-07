import { Edit3, GitBranch, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { BranchedFromBanner } from "@/components/chat-studio/timeline/BranchedFromBanner";
import { roleVariants, UsageInline } from "@/components/chat-studio/timeline/timeline-constants";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppConfig } from "@/providers/config-provider";

import type { ChatMessageEntry } from "@/components/chat-studio/lib/chat-types";
import type { Components } from "react-markdown";

interface MessageEntryProps {
  entry: ChatMessageEntry;
  selectedSessionId: string | null;
  sending: boolean;
  editingMessageId: string | null;
  editingDraft: string;
  editTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onEditChange: (value: string) => void;
  onEditStart: (messageId: string, content: string) => void;
  onEditCancel: () => void;
  onEditSubmit: () => void;
  onRetryAssistant: (messageId: string) => void;
  onBranchMessage: (messageId: string) => void;
  markdownComponents: Components;
  branchedFromSessionId: string | null;
  branchedFromSessionTitle: string | null;
  branchedFromMessageId: string | null;
  branchedFromOrigin: "edit" | "manual";
  onNavigateToSession: (sessionId: string) => void;
}

export const MessageEntry = ({
  entry,
  selectedSessionId,
  sending,
  editingMessageId,
  editingDraft,
  editTextareaRef,
  onEditChange,
  onEditStart,
  onEditCancel,
  onEditSubmit,
  onRetryAssistant,
  onBranchMessage,
  markdownComponents,
  branchedFromSessionId,
  branchedFromSessionTitle,
  branchedFromMessageId,
  branchedFromOrigin,
  onNavigateToSession,
}: MessageEntryProps) => {
  const { config } = useAppConfig();
  const branchingEnabled = config.features.chat_branching !== false;

  const variant = roleVariants[entry.type] ?? roleVariants.system;
  const isUser = entry.type === "user";
  const isAssistant = entry.type === "assistant";
  const showActions = (isUser || isAssistant) && !!selectedSessionId;
  const alignClass = isUser ? "justify-end" : "justify-start";
  const usage = entry.message.usage;
  const headerLabel = entry.message.role === "user" ? "You" : entry.message.role.toUpperCase();

  const branchFooter =
    selectedSessionId && branchingEnabled ? (
      <div className="absolute left-0 right-0 top-full mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-300/70 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        {usage && <UsageInline usage={usage} />}
        <button
          type="button"
          className="pointer-events-auto inline-flex items-center justify-center rounded-full border border-white/20 p-1 text-white/80 hover:border-white/60"
          onClick={() => onBranchMessage(entry.message.id)}
          disabled={sending}
          aria-label="Branch chat"
        >
          <GitBranch className="h-3.5 w-3.5" />
        </button>
      </div>
    ) : null;
  const hasBranchFooter = Boolean(branchFooter);

  const shouldShowBranchedFrom =
    Boolean(branchedFromMessageId) && entry.message.source_message_id === branchedFromMessageId;
  const branchedFromLabel = branchedFromSessionTitle || "Original chat";
  const branchBanner = shouldShowBranchedFrom ? (
    <BranchedFromBanner
      className="mb-2 flex items-center gap-2 text-[11px] text-slate-300/80"
      branchedFromSessionId={branchedFromSessionId}
      branchedFromLabel={branchedFromLabel}
      onNavigateToSession={onNavigateToSession}
    />
  ) : null;
  const shouldShowBannerAbove =
    shouldShowBranchedFrom && entry.message.role === "user" && branchedFromOrigin === "edit";
  const shouldShowBannerBelow = shouldShowBranchedFrom && !shouldShowBannerAbove;

  const isEditing = isUser && editingMessageId === entry.message.id;
  const editHighlight = isEditing
    ? "border-violet-300/80 bg-violet-500/25 shadow-[0_0_0_1px_rgba(196,181,253,0.35)]"
    : null;

  return (
    <div className={cn("flex", alignClass, hasBranchFooter && "mb-5")}>
      <div className={cn("group relative max-w-[75%]", isEditing && "w-full")}>
        {shouldShowBannerAbove ? branchBanner : null}
        <div
          className={cn(
            "chat-bubble rounded-2xl border px-4 py-3 text-sm shadow-2xl transition",
            variant,
            editHighlight,
            isEditing && "w-full",
          )}
          data-chat-role={entry.type}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.3em] text-white/70">
              {headerLabel}
              {entry.message.tool_name ? ` • ${entry.message.tool_name}` : ""}
            </p>
            {showActions && (
              <div className="flex items-center gap-2 text-[11px] text-white/80">
                {isUser && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 hover:border-white/60"
                    onClick={() => onEditStart(entry.message.id, entry.message.content)}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                )}
                {isAssistant && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 hover:border-white/60"
                    onClick={() => onRetryAssistant(entry.message.id)}
                    disabled={sending}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                ref={editTextareaRef}
                className="min-h-[64px] w-full resize-none overflow-hidden rounded-xl bg-violet-500/15 px-4 py-3 text-sm leading-relaxed text-white outline-none"
                value={editingDraft}
                onChange={(event) => onEditChange(event.target.value)}
              />
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={onEditSubmit} loading={sending}>
                  Update & rerun
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={onEditCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : isAssistant ? (
            <div className="space-y-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {entry.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{entry.content}</p>
          )}
        </div>
        {shouldShowBannerBelow ? branchBanner : null}
        {branchFooter}
      </div>
    </div>
  );
};
