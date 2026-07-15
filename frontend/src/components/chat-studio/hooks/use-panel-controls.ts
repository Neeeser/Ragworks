"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TELEMETRY_SECTION_IDS } from "@/components/chat-studio/lib/chat-constants";

const HISTORY_PANEL_WIDTH_PX = 288;
const TELEMETRY_PANEL_WIDTH_PX = 416;
const MIN_CENTER_PANEL_WIDTH_PX = 720;
const OVERLAY_TRIGGER_WIDTH_PX =
  HISTORY_PANEL_WIDTH_PX + TELEMETRY_PANEL_WIDTH_PX + MIN_CENTER_PANEL_WIDTH_PX;

type Dispatch<T> = React.Dispatch<React.SetStateAction<T>>;

const usePersistentToggle = (key: string) => {
  // First paint is closed so server and client markup agree; the stored value
  // is read after mount to avoid a hydration mismatch.
  const [value, setValue] = useState(false);
  const skipFirstPersistRef = useRef(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) {
      setValue(stored === "true");
    }
  }, [key]);

  useEffect(() => {
    // Skip the initial commit so the default never clobbers the stored value before
    // the hydration effect above has had a chance to apply it.
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false;
      return;
    }
    window.localStorage.setItem(key, value ? "true" : "false");
  }, [key, value]);

  // Stable toggle so memoised children don't see a fresh handler each render.
  const toggle = useCallback(() => setValue((prev) => !prev), []);

  return [value, setValue, toggle] as const;
};

interface UsePanelControlsParams {
  setLoading: Dispatch<boolean>;
}

export interface UsePanelControlsResult {
  chatPanelRef: React.MutableRefObject<HTMLDivElement | null>;
  isOverlayMode: boolean;
  hydrated: boolean;
  historyOpen: boolean;
  telemetryOpen: boolean;
  setHistoryOpen: Dispatch<boolean>;
  setTelemetryOpen: Dispatch<boolean>;
  modelSelectorOpen: boolean;
  toggleModelSelector: () => void;
  systemPromptOpen: boolean;
  toggleSystemPrompt: () => void;
  collectionToolsOpen: boolean;
  toggleCollectionTools: () => void;
  vitalsOpen: boolean;
  toggleVitals: () => void;
  usageOpen: boolean;
  toggleUsage: () => void;
  modelParametersOpen: boolean;
  toggleModelParameters: () => void;
  providerPreferencesOpen: boolean;
  toggleProviderPreferences: () => void;
  streamingOptionsOpen: boolean;
  toggleStreamingOptions: () => void;
  handleHistoryOpen: () => void;
  handleHistoryClose: () => void;
  handleTelemetryOpen: () => void;
  handleTelemetryClose: () => void;
  handleOverrideSelect: (sectionId: string) => void;
}

/**
 * Owns the panel/overlay UI: persistent open toggles for every run-settings section,
 * the responsive overlay-mode measurement, hydration gating, and the open/close plus
 * jump-to-section handlers the header, timeline, and telemetry panel share.
 */
export function usePanelControls(params: UsePanelControlsParams): UsePanelControlsResult {
  const { setLoading } = params;

  const [historyOpen, setHistoryOpen] = usePersistentToggle("chat.historyOpen");
  const [telemetryOpen, setTelemetryOpen] = usePersistentToggle("chat.telemetryOpen");
  const [modelSelectorOpen, setModelSelectorOpen, toggleModelSelector] = usePersistentToggle(
    "chat.telemetry.modelsOpen",
  );
  const [systemPromptOpen, setSystemPromptOpen, toggleSystemPrompt] = usePersistentToggle(
    "chat.telemetry.promptOpen",
  );
  const [collectionToolsOpen, setCollectionToolsOpen, toggleCollectionTools] = usePersistentToggle(
    "chat.telemetry.toolsOpen",
  );
  const [vitalsOpen, , toggleVitals] = usePersistentToggle("chat.telemetry.vitalsOpen");
  const [usageOpen, , toggleUsage] = usePersistentToggle("chat.telemetry.usageOpen");
  const [modelParametersOpen, setModelParametersOpen, toggleModelParameters] = usePersistentToggle(
    "chat.telemetry.parametersOpen",
  );
  const [providerPreferencesOpen, setProviderPreferencesOpen, toggleProviderPreferences] =
    usePersistentToggle("chat.telemetry.providersOpen");
  const [streamingOptionsOpen, setStreamingOptionsOpen, toggleStreamingOptions] =
    usePersistentToggle("chat.telemetry.streamingOpen");

  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  // Starts at 0 (non-overlay) for a stable first paint; the real width is measured
  // after mount by the ResizeObserver effect below.
  const [chatPanelWidth, setChatPanelWidth] = useState(0);
  const isOverlayMode = chatPanelWidth > 0 && chatPanelWidth < OVERLAY_TRIGGER_WIDTH_PX;
  // Flips true once storage/viewport values have been read post-mount, so effects that
  // depend on them (e.g. the overlay auto-close) don't act on first-paint defaults.
  const [hydrated, setHydrated] = useState(false);

  // Post-mount hydration of storage/viewport-derived state, kept out of the useState
  // initializers so server and first client render agree.
  useEffect(() => {
    if (window.sessionStorage.getItem("chatStudio.loaded") === "true") {
      setLoading(false);
    }
    setChatPanelWidth((prev) => (prev === 0 ? window.innerWidth : prev));
    setHydrated(true);
  }, [setLoading]);

  useEffect(() => {
    const element = chatPanelRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setChatPanelWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Gate on hydration so the auto-close doesn't fire on first-paint defaults before
    // the persisted panel-open values have been read back.
    if (!hydrated || !isOverlayMode) {
      return;
    }
    if (historyOpen && telemetryOpen) {
      setTelemetryOpen(false);
    }
  }, [hydrated, historyOpen, isOverlayMode, telemetryOpen, setTelemetryOpen]);

  const handleHistoryClose = useCallback(() => {
    setHistoryOpen(false);
  }, [setHistoryOpen]);

  const handleTelemetryClose = useCallback(() => {
    setTelemetryOpen(false);
  }, [setTelemetryOpen]);

  const handleHistoryOpen = useCallback(() => {
    setHistoryOpen(true);
    if (isOverlayMode) {
      setTelemetryOpen(false);
    }
  }, [isOverlayMode, setHistoryOpen, setTelemetryOpen]);

  const handleTelemetryOpen = useCallback(() => {
    setTelemetryOpen(true);
    if (isOverlayMode) {
      setHistoryOpen(false);
    }
  }, [isOverlayMode, setHistoryOpen, setTelemetryOpen]);

  const handleOverrideSelect = useCallback(
    (sectionId: string) => {
      setTelemetryOpen(true);
      switch (sectionId) {
        case TELEMETRY_SECTION_IDS.systemPrompt:
          setSystemPromptOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.collectionTools:
          setCollectionToolsOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.streaming:
          setStreamingOptionsOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.modelRouting:
          setModelSelectorOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.providerRouting:
          setProviderPreferencesOpen(true);
          break;
        case TELEMETRY_SECTION_IDS.modelParameters:
          setModelParametersOpen(true);
          break;
        default:
          break;
      }
      if (typeof document === "undefined") {
        return;
      }
      const scrollToSection = () => {
        const target = document.getElementById(sectionId);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };
      window.requestAnimationFrame(scrollToSection);
      window.setTimeout(scrollToSection, 80);
    },
    [
      setCollectionToolsOpen,
      setModelParametersOpen,
      setModelSelectorOpen,
      setProviderPreferencesOpen,
      setStreamingOptionsOpen,
      setSystemPromptOpen,
      setTelemetryOpen,
    ],
  );

  return {
    chatPanelRef,
    isOverlayMode,
    hydrated,
    historyOpen,
    telemetryOpen,
    setHistoryOpen,
    setTelemetryOpen,
    modelSelectorOpen,
    toggleModelSelector,
    systemPromptOpen,
    toggleSystemPrompt,
    collectionToolsOpen,
    toggleCollectionTools,
    vitalsOpen,
    toggleVitals,
    usageOpen,
    toggleUsage,
    modelParametersOpen,
    toggleModelParameters,
    providerPreferencesOpen,
    toggleProviderPreferences,
    streamingOptionsOpen,
    toggleStreamingOptions,
    handleHistoryOpen,
    handleHistoryClose,
    handleTelemetryOpen,
    handleTelemetryClose,
    handleOverrideSelect,
  };
}
