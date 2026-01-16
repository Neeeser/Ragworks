"use client";

import { PlusCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

type ChatStudioHeaderProps = {
  collectionLabel: string;
  collectionMetaLabel: string;
  currentModelLabel: string;
  showNewChatButton: boolean;
  onModelSelect: () => void;
  onNewChat: () => void;
};

export function ChatStudioHeader({
  collectionLabel,
  collectionMetaLabel,
  currentModelLabel,
  showNewChatButton,
  onModelSelect,
  onNewChat,
}: ChatStudioHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
      <div className="flex items-start gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Conversation</p>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold text-white">{collectionLabel}</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
              {collectionMetaLabel}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onModelSelect}
          className="hidden min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-slate-300 transition hover:border-white/30 hover:text-white sm:flex"
        >
          <span className="text-[10px] uppercase tracking-[0.35em] text-slate-500">Model</span>
          <span className="min-w-0 truncate text-sm font-semibold text-white">
            {currentModelLabel}
          </span>
        </button>
        {showNewChatButton && (
          <Button
            variant="secondary"
            className="flex h-10 items-center justify-center gap-2 px-3 whitespace-nowrap"
            onClick={onNewChat}
          >
            <PlusCircle className="h-4 w-4" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
        )}
      </div>
    </div>
  );
}
