"use client";

import { useCallback, useMemo, useState } from "react";

import { TELEMETRY_SECTION_IDS } from "@/components/chat-studio/lib/chat-constants";
import { useMediaQuery } from "@/lib/use-media-query";

import type { UsePanelControlsResult } from "@/components/chat-studio/hooks/use-panel-controls";
import type { CatalogModel } from "@/lib/types";

/**
 * Below `lg` the run-settings pane covers the whole screen, so the first-run
 * default is desktop-only. `useMediaQuery`'s server snapshot is `false`, which
 * keeps the pane closed in the server markup and in the first client paint and
 * lets the real width reconcile after hydration.
 */
const WIDE_VIEWPORT_QUERY = "(min-width: 1024px)";

interface UseChatModelAffordanceParams {
  panel: UsePanelControlsResult;
  currentModelInfo: CatalogModel | null;
  activeModelId: string | null;
  /** The transcript already holds entries, so this session is under way. */
  hasMessages: boolean;
  /** The studio finished loading; before that no model state is known. */
  ready: boolean;
}

/** How the run-settings pane is presented once the first-run default is folded in. */
export interface RunSettingsPresentation {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export interface UseChatModelAffordanceResult {
  /** The model this turn runs on, or `null` while none is selected. */
  currentModelLabel: string | null;
  /** Nothing is selected and nothing has been sent: this turn cannot run yet. */
  needsChatModel: boolean;
  /** Opens run settings at Model routing — the only place a model is chosen. */
  onSelectModel: () => void;
  runSettings: RunSettingsPresentation;
}

/**
 * Owns how the studio asks for a chat model: what the top bar reads, whether the
 * empty state offers the choice, and whether run settings opens on its own the
 * first time round.
 *
 * A model has to be picked before any message can run, and the only control that
 * picks one lives inside the run-settings pane — which starts closed. This hook
 * is the one place that decides when that has to be surfaced instead of hidden.
 */
export function useChatModelAffordance({
  panel,
  currentModelInfo,
  activeModelId,
  hasMessages,
  ready,
}: UseChatModelAffordanceParams): UseChatModelAffordanceResult {
  const {
    telemetryOpen,
    hydrated,
    isOverlayMode,
    handleTelemetryOpen,
    handleTelemetryClose,
    handleOverrideSelect,
  } = panel;

  const isWideViewport = useMediaQuery(WIDE_VIEWPORT_QUERY);
  // Set the moment the user closes the pane themselves; the first-run default
  // never reopens it after that, for the rest of the session.
  const [dismissed, setDismissed] = useState(false);

  const currentModelLabel = currentModelInfo?.name || activeModelId || null;
  const needsChatModel = ready && !currentModelLabel && !hasMessages;

  // Derived on every render, never written to state. A default stored by an
  // effect re-fires on each background refetch — the auth provider rotates its
  // token every 12 minutes and re-runs every data effect — so the pane would
  // spring open under a user who had closed it, and would stay open after a
  // model was chosen. `hydrated` gates on the post-mount width measurement, so
  // `isOverlayMode` is real rather than its pre-measurement default.
  const open =
    telemetryOpen || (needsChatModel && hydrated && isWideViewport && !isOverlayMode && !dismissed);

  const onClose = useCallback(() => {
    setDismissed(true);
    handleTelemetryClose();
  }, [handleTelemetryClose]);

  const onSelectModel = useCallback(
    () => handleOverrideSelect(TELEMETRY_SECTION_IDS.modelRouting),
    [handleOverrideSelect],
  );

  const runSettings = useMemo(
    () => ({ open, onOpen: handleTelemetryOpen, onClose }),
    [handleTelemetryOpen, onClose, open],
  );

  return { currentModelLabel, needsChatModel, onSelectModel, runSettings };
}
