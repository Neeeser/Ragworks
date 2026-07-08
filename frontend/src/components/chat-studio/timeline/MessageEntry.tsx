import { Edit3, GitBranch, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { BranchedFromBanner } from "@/components/chat-studio/timeline/BranchedFromBanner";
import { roleVariants, UsageInline } from "@/components/chat-studio/timeline/timeline-constants";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppConfig } from "@/providers/config-provider";

import type { ChatMessageEntry } from "@/components/chat-studio/lib/chat-types";
import type { UsageBreakdown } from "@/lib/types";
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

interface BranchFooterProps {
  show: boolean;
  usage: UsageBreakdown | null | undefined;
  sending: boolean;
  messageId: string;
  onBranchMessage: (messageId: string) => void;
}

/** Hover footer under a bubble: inline usage stats and the branch button. */
function BranchFooter({ show, usage, sending, messageId, onBranchMessage }: BranchFooterProps) {
  if (!show) {
    return null;
  }
  return (
    <div className="absolute left-0 right-0 top-full mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-300/70 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      {usage && <UsageInline usage={usage} />}
      <button
        type="button"
        className="pointer-events-auto inline-flex items-center justify-center rounded-full border border-white/20 p-1 text-white/80 hover:border-white/60"
        onClick={() => onBranchMessage(messageId)}
        disabled={sending}
        aria-label="Branch chat"
      >
        <GitBranch className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface MessageActionsProps {
  isUser: boolean;
  isAssistant: boolean;
  sending: boolean;
  messageId: string;
  content: string;
  onEditStart: (messageId: string, content: string) => void;
  onRetryAssistant: (messageId: string) => void;
}

/** Per-role header actions: Edit for user bubbles, Retry for assistant ones. */
function MessageActions({
  isUser,
  isAssistant,
  sending,
  messageId,
  content,
  onEditStart,
  onRetryAssistant,
}: MessageActionsProps) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-white/80">
      {isUser && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 hover:border-white/60"
          onClick={() => onEditStart(messageId, content)}
        >
          <Edit3 className="h-3.5 w-3.5" />
          Edit
        </button>
      )}
      {isAssistant && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 hover:border-white/60"
          onClick={() => onRetryAssistant(messageId)}
          disabled={sending}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

interface MessageBodyProps {
  isEditing: boolean;
  isAssistant: boolean;
  content: string;
  editingDraft: string;
  editTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  markdownComponents: Components;
  onEditChange: (value: string) => void;
  onEditCancel: () => void;
  onEditSubmit: () => void;
}

/** The bubble body: edit textarea, rendered markdown, or plain text. */
function MessageBody({
  isEditing,
  isAssistant,
  content,
  editingDraft,
  editTextareaRef,
  sending,
  markdownComponents,
  onEditChange,
  onEditCancel,
  onEditSubmit,
}: MessageBodyProps) {
  if (isEditing) {
    return (
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
    );
  }
  if (isAssistant) {
    return (
      <div className="space-y-3">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }
  return <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>;
}

interface BranchBannerState {
  above: React.ReactNode;
  below: React.ReactNode;
}

/** Resolve whether (and where) the branched-from banner renders for a message. */
function resolveBranchBanner(
  props: Pick<
    MessageEntryProps,
    | "entry"
    | "branchedFromSessionId"
    | "branchedFromSessionTitle"
    | "branchedFromMessageId"
    | "branchedFromOrigin"
    | "onNavigateToSession"
  >,
): BranchBannerState {
  const { entry, branchedFromMessageId } = props;
  const show =
    Boolean(branchedFromMessageId) && entry.message.source_message_id === branchedFromMessageId;
  if (!show) {
    return { above: null, below: null };
  }
  const banner = (
    <BranchedFromBanner
      className="mb-2 flex items-center gap-2 text-[11px] text-slate-300/80"
      branchedFromSessionId={props.branchedFromSessionId}
      branchedFromLabel={props.branchedFromSessionTitle || "Original chat"}
      onNavigateToSession={props.onNavigateToSession}
    />
  );
  const above = entry.message.role === "user" && props.branchedFromOrigin === "edit";
  return { above: above ? banner : null, below: above ? null : banner };
}

export const MessageEntry = (props: MessageEntryProps) => {
  const {
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
  } = props;
  const { config } = useAppConfig();
  const branchingEnabled = config.features.chat_branching !== false;

  const variant = roleVariants[entry.type] ?? roleVariants.system;
  const isUser = entry.type === "user";
  const isAssistant = entry.type === "assistant";
  const showActions = (isUser || isAssistant) && !!selectedSessionId;
  const headerLabel = entry.message.role === "user" ? "You" : entry.message.role.toUpperCase();
  const showBranchFooter = Boolean(selectedSessionId) && branchingEnabled;
  const banner = resolveBranchBanner(props);
  const isEditing = isUser && editingMessageId === entry.message.id;

  return (
    <div
      className={cn("flex", isUser ? "justify-end" : "justify-start", showBranchFooter && "mb-5")}
    >
      <div className={cn("group relative max-w-[75%]", isEditing && "w-full")}>
        {banner.above}
        <div
          className={cn(
            "chat-bubble rounded-2xl border px-4 py-3 text-sm shadow-2xl transition",
            variant,
            isEditing &&
              "w-full border-violet-300/80 bg-violet-500/25 shadow-[0_0_0_1px_rgba(196,181,253,0.35)]",
          )}
          data-chat-role={entry.type}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.3em] text-white/70">
              {headerLabel}
              {entry.message.tool_name ? ` • ${entry.message.tool_name}` : ""}
            </p>
            {showActions && (
              <MessageActions
                isUser={isUser}
                isAssistant={isAssistant}
                sending={sending}
                messageId={entry.message.id}
                content={entry.message.content}
                onEditStart={onEditStart}
                onRetryAssistant={onRetryAssistant}
              />
            )}
          </div>
          <MessageBody
            isEditing={isEditing}
            isAssistant={isAssistant}
            content={entry.content}
            editingDraft={editingDraft}
            editTextareaRef={editTextareaRef}
            sending={sending}
            markdownComponents={markdownComponents}
            onEditChange={onEditChange}
            onEditCancel={onEditCancel}
            onEditSubmit={onEditSubmit}
          />
        </div>
        {banner.below}
        <BranchFooter
          show={showBranchFooter}
          usage={entry.message.usage}
          sending={sending}
          messageId={entry.message.id}
          onBranchMessage={onBranchMessage}
        />
      </div>
    </div>
  );
};
