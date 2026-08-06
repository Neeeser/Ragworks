import { Edit3, GitBranch, RotateCcw } from "lucide-react";

import { BranchedFromBanner } from "@/components/chat-studio/timeline/BranchedFromBanner";
import { roleVariants, UsageInline } from "@/components/chat-studio/timeline/timeline-constants";
import { AssetImage } from "@/components/ui/asset-image";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Markdown } from "@/components/ui/markdown";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useAppConfig } from "@/providers/config-provider";

import type { ChatMessageEntry } from "@/components/chat-studio/lib/chat-types";
import type { ChatMessage, MediaAssetRef, UsageBreakdown } from "@/lib/types";

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

/** What the turn cost, and the way to fork the conversation from it. */
function BranchFooter({ show, usage, sending, messageId, onBranchMessage }: BranchFooterProps) {
  if (!show) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 opacity-0 transition-opacity duration-120 ease-decel group-focus-within:opacity-100 group-hover:opacity-100">
      {usage && <UsageInline usage={usage} />}
      <Tooltip content="Branch a new chat from this message">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onBranchMessage(messageId)}
          disabled={sending}
          aria-label="Branch chat"
        >
          <GitBranch className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </Tooltip>
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

/** Per-role header actions: Edit for user turns, Retry for assistant ones. */
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
    <div className="flex items-center gap-1">
      {isUser && (
        <Button size="sm" variant="ghost" onClick={() => onEditStart(messageId, content)}>
          <Edit3 className="h-3.5 w-3.5" aria-hidden />
          Edit
        </Button>
      )}
      {isAssistant && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRetryAssistant(messageId)}
          disabled={sending}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Retry
        </Button>
      )}
    </div>
  );
}

/** The images the user attached to this message, from their stored records. */
function MessageAttachments({ message }: { message: ChatMessage }) {
  const { token } = useAuth();
  const assets: MediaAssetRef[] = (message.attachments ?? []).map((attachment) => ({
    media_type: attachment.media_type,
    path: attachment.path,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
  }));
  if (!token || assets.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-2">
      {assets.map((asset) => (
        <AssetImage
          key={asset.path}
          token={token}
          source={{ chatSessionId: message.session_id }}
          asset={asset}
          alt="Attached image"
        />
      ))}
    </div>
  );
}

interface MessageBodyProps {
  isEditing: boolean;
  isAssistant: boolean;
  isUser: boolean;
  content: string;
  editingDraft: string;
  editTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  onEditChange: (value: string) => void;
  onEditCancel: () => void;
  onEditSubmit: () => void;
}

/**
 * The turn's content: an edit box, rendered markdown, or plain text.
 *
 * Prose caps at a reading measure inside a pane that stays full width — the
 * assistant's answer is read, so it gets a line length rather than a bubble.
 */
function MessageBody({
  isEditing,
  isAssistant,
  isUser,
  content,
  editingDraft,
  editTextareaRef,
  sending,
  onEditChange,
  onEditCancel,
  onEditSubmit,
}: MessageBodyProps) {
  if (isEditing) {
    return (
      <div className="space-y-2">
        <textarea
          ref={editTextareaRef}
          className={cn(inputClass, "min-h-16 resize-none overflow-hidden leading-relaxed")}
          value={editingDraft}
          onChange={(event) => onEditChange(event.target.value)}
        />
        <div className="flex items-center gap-2">
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
    return <Markdown className="max-w-[66ch]">{content}</Markdown>;
  }
  return (
    <p
      className={cn(
        "whitespace-pre-wrap text-ui leading-relaxed",
        isUser ? "max-w-[66ch]" : "max-w-[66ch] text-body",
      )}
    >
      {content}
    </p>
  );
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
      className="flex items-center gap-1.5"
      branchedFromSessionId={props.branchedFromSessionId}
      branchedFromLabel={props.branchedFromSessionTitle || "Original chat"}
      onNavigateToSession={props.onNavigateToSession}
    />
  );
  const above = entry.message.role === "user" && props.branchedFromOrigin === "edit";
  return { above: above ? banner : null, below: above ? null : banner };
}

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
  system: "System",
  tool: "Tool",
  error: "Error",
};

/**
 * One turn in the transcript.
 *
 * A user turn is a tinted block aligned right; the assistant's answer sits
 * directly on the card's material with a reading measure, because it is the
 * thing being read rather than a thing being distinguished.
 */
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
  } = props;
  const { config } = useAppConfig();
  const branchingEnabled = config.features.chat_branching !== false;

  const variant = roleVariants[entry.type] ?? roleVariants.system;
  const isUser = entry.type === "user";
  const isAssistant = entry.type === "assistant";
  const showActions = (isUser || isAssistant) && !!selectedSessionId;
  const roleLabel = ROLE_LABELS[entry.message.role] ?? entry.message.role;
  const headerLabel = entry.message.tool_name
    ? `${roleLabel} • ${entry.message.tool_name}`
    : roleLabel;
  const showBranchFooter = Boolean(selectedSessionId) && branchingEnabled;
  const banner = resolveBranchBanner(props);
  const isEditing = isUser && editingMessageId === entry.message.id;

  return (
    <div
      className={cn("group flex flex-col gap-1.5", isUser && !isEditing && "items-end")}
      data-chat-role={entry.type}
    >
      {banner.above}
      <div className={cn("flex items-center gap-2", isUser && !isEditing && "flex-row-reverse")}>
        <InstrumentLabel>{headerLabel}</InstrumentLabel>
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
      <div
        className={cn(
          "min-w-0",
          // The assistant's answer needs no container of its own; every other
          // role is a distinguishable block.
          !isAssistant && "rounded-panel border px-3 py-2",
          !isAssistant && variant,
          isUser && !isEditing && "w-fit max-w-full",
          isEditing && "w-full border-accent-violet/60",
        )}
      >
        {isUser && !isEditing ? <MessageAttachments message={entry.message} /> : null}
        <MessageBody
          isEditing={isEditing}
          isAssistant={isAssistant}
          isUser={isUser}
          content={entry.content}
          editingDraft={editingDraft}
          editTextareaRef={editTextareaRef}
          sending={sending}
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
  );
};
