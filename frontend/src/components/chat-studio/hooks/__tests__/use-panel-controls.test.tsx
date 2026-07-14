import { act, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePanelControls } from "@/components/chat-studio/hooks/use-panel-controls";
import { TELEMETRY_SECTION_IDS } from "@/components/chat-studio/lib/chat-constants";

const TOGGLES = [
  ["chat.historyOpen", "historyOpen"],
  ["chat.telemetryOpen", "telemetryOpen"],
  ["chat.telemetry.modelsOpen", "modelSelectorOpen"],
  ["chat.telemetry.promptOpen", "systemPromptOpen"],
  ["chat.telemetry.toolsOpen", "collectionToolsOpen"],
  ["chat.telemetry.vitalsOpen", "vitalsOpen"],
  ["chat.telemetry.usageOpen", "usageOpen"],
  ["chat.telemetry.parametersOpen", "modelParametersOpen"],
  ["chat.telemetry.providersOpen", "providerPreferencesOpen"],
  ["chat.telemetry.streamingOpen", "streamingOptionsOpen"],
] as const;

const renderPanelControls = () => {
  const setLoading = vi.fn();
  return renderHook(() => usePanelControls({ setLoading }));
};

const setAllStoredToggles = (value: string) => {
  for (const [key] of TOGGLES) {
    window.localStorage.setItem(key, value);
  }
};

const expectAllToggles = (current: ReturnType<typeof usePanelControls>, expected: boolean) => {
  for (const [, property] of TOGGLES) {
    expect(current[property], property).toBe(expected);
  }
};

describe("usePanelControls", () => {
  beforeEach(() => {
    window.innerWidth = 1600;
  });

  it("defaults every drawer and run-settings section to closed", () => {
    const { result } = renderPanelControls();

    expectAllToggles(result.current, false);
  });

  it("restores stored open preferences", () => {
    setAllStoredToggles("true");

    const { result } = renderPanelControls();

    expectAllToggles(result.current, true);
  });

  it("restores stored closed preferences", () => {
    setAllStoredToggles("false");

    const { result } = renderPanelControls();

    expectAllToggles(result.current, false);
  });

  it("falls back to closed for corrupt stored preferences", () => {
    setAllStoredToggles("corrupt");

    const { result } = renderPanelControls();

    expectAllToggles(result.current, false);
  });

  it("renders closed first-paint markup before storage hydration", () => {
    setAllStoredToggles("true");

    const markup = renderToStaticMarkup(<FirstPaintState />);

    expect(markup).toContain('data-open-panels="0"');
  });

  it("persists a user-selected state for the next mount", () => {
    const first = renderPanelControls();

    act(() => first.result.current.handleHistoryOpen());
    expect(window.localStorage.getItem("chat.historyOpen")).toBe("true");
    first.unmount();

    const second = renderPanelControls();
    expect(second.result.current.historyOpen).toBe(true);
  });

  it("reveals only the requested run-settings section", () => {
    const { result } = renderPanelControls();

    act(() => result.current.handleOverrideSelect(TELEMETRY_SECTION_IDS.systemPrompt));

    expect(result.current.telemetryOpen).toBe(true);
    expect(result.current.systemPromptOpen).toBe(true);
    expect(result.current.modelSelectorOpen).toBe(false);
    expect(result.current.collectionToolsOpen).toBe(false);
    expect(result.current.streamingOptionsOpen).toBe(false);
    expect(result.current.providerPreferencesOpen).toBe(false);
    expect(result.current.modelParametersOpen).toBe(false);
  });

  it("keeps the responsive overlays mutually exclusive", () => {
    window.innerWidth = 800;
    const { result } = renderPanelControls();

    expect(result.current.isOverlayMode).toBe(true);

    act(() => result.current.handleHistoryOpen());
    expect(result.current.historyOpen).toBe(true);
    expect(result.current.telemetryOpen).toBe(false);

    act(() => result.current.handleTelemetryOpen());
    expect(result.current.historyOpen).toBe(false);
    expect(result.current.telemetryOpen).toBe(true);
  });
});

function FirstPaintState() {
  const controls = usePanelControls({ setLoading: vi.fn() });
  const openPanelCount = TOGGLES.filter(([, property]) => controls[property]).length;
  return <div data-open-panels={openPanelCount} />;
}
