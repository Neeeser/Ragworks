"use client";

import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { Fragment } from "react";

import { Loader } from "@/components/ui/loader";
import { Notification } from "@/components/ui/notification";
import { GlassCard } from "@/components/ui/panel";

import type { ReactNode, RefObject } from "react";

type ChatStudioViewProps = {
  status: string | null;
  onStatusDismiss: () => void;
  loading: boolean;
  chatPanelRef: RefObject<HTMLDivElement>;
  isOverlayMode: boolean;
  historyOpen: boolean;
  telemetryOpen: boolean;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
  onOpenTelemetry: () => void;
  onCloseTelemetry: () => void;
  header: ReactNode;
  messagesPanel: ReactNode;
  historyPanel: ReactNode;
  telemetryPanel: ReactNode;
  promptEditor: ReactNode;
};

export function ChatStudioView({
  status,
  onStatusDismiss,
  loading,
  chatPanelRef,
  isOverlayMode,
  historyOpen,
  telemetryOpen,
  onOpenHistory,
  onCloseHistory,
  onOpenTelemetry,
  onCloseTelemetry,
  header,
  messagesPanel,
  historyPanel,
  telemetryPanel,
  promptEditor,
}: ChatStudioViewProps) {
  return (
    <Fragment>
      <div className="relative flex h-full flex-col">
        {status && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-40 w-full max-w-2xl -translate-x-1/2 px-4">
            <Notification
              title="Action required"
              message={status}
              onDismiss={onStatusDismiss}
              className="pointer-events-auto"
            />
          </div>
        )}

        <div className="flex flex-1 flex-col min-h-0">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <GlassCard className="flex items-center justify-center rounded-[2rem] p-10">
                <Loader className="h-6 w-6" />
              </GlassCard>
            </div>
          ) : (
            <div
              ref={chatPanelRef}
              className="glass-panel relative flex flex-1 min-h-0 overflow-hidden rounded-[2.5rem] border border-white/5 bg-slate-950/80"
            >
              {!isOverlayMode && historyOpen && (
                <aside className="h-full w-72 flex-shrink-0 border-r border-white/5 bg-black/40">
                  {historyPanel}
                </aside>
              )}
              {!historyOpen && (
                <button
                  type="button"
                  aria-label="Open history"
                  className="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/40 p-2 text-slate-200 transition-all hover:border-white/40 hover:bg-black/60"
                  onClick={onOpenHistory}
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              )}
              <div className="relative flex min-w-0 flex-1 flex-col min-h-0">
                {header}
                {messagesPanel}
              </div>

              {!isOverlayMode && telemetryOpen && (
                <aside className="h-full w-[26rem] flex-shrink-0 border-l border-white/5 bg-black/40 p-6">
                  {telemetryPanel}
                </aside>
              )}
              {!telemetryOpen && (
                <button
                  type="button"
                  aria-label="Open run settings"
                  className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 p-2 text-slate-200 hover:border-white/40"
                  onClick={onOpenTelemetry}
                >
                  <PanelRightOpen className="h-4 w-4" />
                </button>
              )}
              {isOverlayMode && historyOpen && (
                <div className="absolute inset-0 z-40">
                  <button
                    type="button"
                    aria-label="Close history"
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                    onClick={onCloseHistory}
                  />
                  <aside className="relative z-10 h-full w-72 border-r border-white/5 bg-black/90">
                    {historyPanel}
                  </aside>
                </div>
              )}
              {isOverlayMode && telemetryOpen && (
                <div className="absolute inset-0 z-40 flex justify-end">
                  <button
                    type="button"
                    aria-label="Close run settings"
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                    onClick={onCloseTelemetry}
                  />
                  <aside className="relative z-10 h-full w-[26rem] border-l border-white/5 bg-black/90 p-6">
                    {telemetryPanel}
                  </aside>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {promptEditor}
    </Fragment>
  );
}
