"use client";

import { Fragment } from "react";

import { PageBody } from "@/components/ui/app-shell";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Notification } from "@/components/ui/notification";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

import type { ReactNode, RefObject } from "react";

type ChatStudioViewProps = {
  status: string | null;
  onStatusDismiss: () => void;
  loading: boolean;
  chatPanelRef: RefObject<HTMLDivElement | null>;
  isOverlayMode: boolean;
  historyOpen: boolean;
  telemetryOpen: boolean;
  onCloseHistory: () => void;
  onCloseTelemetry: () => void;
  header: ReactNode;
  messagesPanel: ReactNode;
  historyPanel: ReactNode;
  telemetryPanel: ReactNode;
  promptEditor: ReactNode;
};

/** The studio's geometry while it loads — same panes, no content yet. */
function StudioSkeleton() {
  return (
    <Panel aria-busy className="flex min-h-0 flex-1 overflow-hidden">
      <div className="hidden w-72 shrink-0 space-y-2 border-r border-hairline bg-surface p-3 lg:block">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 p-4">
          <Skeleton className="h-2 max-w-40" />
          <Skeleton className="h-16 max-w-[66ch]" />
          <Skeleton className="h-2 max-w-32" />
          <Skeleton className="h-24 max-w-[66ch]" />
        </div>
        <div className="shrink-0 border-t border-hairline p-3">
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
      <span className="sr-only">Loading Chat Studio</span>
    </Panel>
  );
}

/**
 * The studio's three panes inside one card: chat history, the transcript with
 * its composer, and run settings — separated by hairline seams rather than by
 * backgrounds of their own, because they are one working surface.
 *
 * Each pane owns its scroll, so reading a long transcript never moves the
 * session list beside it. Below the width where three panes fit, the side panes
 * become overlays instead of disappearing: every session, setting, and control
 * keeps a click path.
 */
export function ChatStudioView({
  status,
  onStatusDismiss,
  loading,
  chatPanelRef,
  isOverlayMode,
  historyOpen,
  telemetryOpen,
  onCloseHistory,
  onCloseTelemetry,
  header,
  messagesPanel,
  historyPanel,
  telemetryPanel,
  promptEditor,
}: ChatStudioViewProps) {
  return (
    <Fragment>
      {header}
      {status && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-center px-4">
          <Notification
            title="Action required"
            message={status}
            onDismiss={onStatusDismiss}
            className="pointer-events-auto w-full max-w-xl"
          />
        </div>
      )}

      <PageBody className="flex flex-col">
        {loading ? (
          <StudioSkeleton />
        ) : (
          // The ref sits on a wrapper rather than the card because the overlay
          // breakpoint is measured from the width the panes actually share.
          <div ref={chatPanelRef} className="flex min-h-0 flex-1">
            <Panel className="flex min-h-0 flex-1 overflow-hidden">
              {/* The side panes take `bg-surface`: the transcript is the pane
                  being worked in, so it keeps the card's own material and the
                  two supporting panes sit a shade back from it. A seam alone
                  reads flat at this width. */}
              {!isOverlayMode && historyOpen && (
                <aside
                  aria-label="Chat history"
                  className="min-h-0 w-72 shrink-0 border-r border-hairline bg-surface"
                >
                  {historyPanel}
                </aside>
              )}

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">{messagesPanel}</div>

              {!isOverlayMode && telemetryOpen && (
                <aside
                  aria-label="Run settings"
                  className="min-h-0 w-[26rem] shrink-0 border-l border-hairline bg-surface"
                >
                  {telemetryPanel}
                </aside>
              )}
            </Panel>
          </div>
        )}
      </PageBody>

      {isOverlayMode && historyOpen && (
        <ModalOverlay open onClose={onCloseHistory} labelledBy="chat-history-overlay-title">
          <div className="flex h-[100dvh] w-80 max-w-[90vw] flex-col bg-canvas-raised">
            <h2 id="chat-history-overlay-title" className="sr-only">
              Chat history
            </h2>
            {historyPanel}
          </div>
        </ModalOverlay>
      )}
      {isOverlayMode && telemetryOpen && (
        <ModalOverlay open onClose={onCloseTelemetry} labelledBy="run-settings-overlay-title">
          <div className="flex h-[100dvh] w-[26rem] max-w-[95vw] flex-col bg-canvas-raised">
            <h2 id="run-settings-overlay-title" className="sr-only">
              Run settings
            </h2>
            {telemetryPanel}
          </div>
        </ModalOverlay>
      )}
      {promptEditor}
    </Fragment>
  );
}
