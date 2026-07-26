import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatModelAffordance } from "@/components/chat-studio/hooks/settings/use-chat-model-affordance";
import { usePanelControls } from "@/components/chat-studio/hooks/use-panel-controls";
import { makeCatalogModel } from "@/test/fixtures";

import type { CatalogModel } from "@/lib/types";

interface AffordanceProps {
  currentModelInfo: CatalogModel | null;
  activeModelId: string | null;
  hasMessages: boolean;
  ready: boolean;
}

const defaultProps: AffordanceProps = {
  currentModelInfo: null,
  activeModelId: null,
  hasMessages: false,
  ready: true,
};

/**
 * Both panes fit side by side above 1424px, which is what `usePanelControls`
 * measures through the mocked ResizeObserver; below `lg` the pane would cover
 * the screen. `matchMedia` answers from the same width so the two agree.
 */
const setViewportWidth = (width: number) => {
  window.innerWidth = width;
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: width >= 1024,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
};

const renderAffordance = (overrides: Partial<AffordanceProps> = {}) => {
  const setLoading = vi.fn();
  return renderHook(
    (props: AffordanceProps) => {
      const panel = usePanelControls({ setLoading });
      return { panel, ...useChatModelAffordance({ panel, ...props }) };
    },
    { initialProps: { ...defaultProps, ...overrides } },
  );
};

describe("useChatModelAffordance", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setViewportWidth(1600);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens run settings on a desktop viewport when no chat model is selected", () => {
    const { result } = renderAffordance();

    expect(result.current.needsChatModel).toBe(true);
    expect(result.current.runSettings.open).toBe(true);
    // The stored preference is untouched: the default is presentation, not state.
    expect(result.current.panel.telemetryOpen).toBe(false);
    expect(window.localStorage.getItem("chat.telemetryOpen")).not.toBe("true");
  });

  it("leaves run settings closed below lg, where the pane would cover the screen", () => {
    setViewportWidth(700);

    const { result } = renderAffordance();

    expect(result.current.needsChatModel).toBe(true);
    expect(result.current.runSettings.open).toBe(false);
  });

  it("leaves run settings closed once a chat model is selected", () => {
    const { result } = renderAffordance({
      currentModelInfo: makeCatalogModel({ name: "Sonnet" }),
    });

    expect(result.current.needsChatModel).toBe(false);
    expect(result.current.runSettings.open).toBe(false);
    expect(result.current.currentModelLabel).toBe("Sonnet");
  });

  it("falls back to the raw model id when the catalog has no entry for it", () => {
    const { result } = renderAffordance({ activeModelId: "anthropic/claude-sonnet-4" });

    expect(result.current.currentModelLabel).toBe("anthropic/claude-sonnet-4");
    expect(result.current.needsChatModel).toBe(false);
  });

  it("leaves run settings closed once the session has messages", () => {
    const { result } = renderAffordance({ hasMessages: true });

    expect(result.current.needsChatModel).toBe(false);
    expect(result.current.runSettings.open).toBe(false);
  });

  it("leaves run settings closed while the studio is still loading", () => {
    const { result } = renderAffordance({ ready: false });

    expect(result.current.needsChatModel).toBe(false);
    expect(result.current.runSettings.open).toBe(false);
  });

  it("keeps run settings closed after the user closes it, while a model is still missing", () => {
    const { result } = renderAffordance();
    expect(result.current.runSettings.open).toBe(true);

    act(() => result.current.runSettings.onClose());

    expect(result.current.needsChatModel).toBe(true);
    expect(result.current.runSettings.open).toBe(false);
  });

  it("does not reopen run settings when background data reloads after the user closed it", () => {
    const { result, rerender } = renderAffordance();
    expect(result.current.runSettings.open).toBe(true);
    act(() => result.current.runSettings.onClose());
    expect(result.current.runSettings.open).toBe(false);

    // The auth provider rotates its token every 12 minutes and re-runs every
    // data effect, handing every consumer fresh identities for unchanged data.
    rerender({ ...defaultProps, currentModelInfo: null });
    rerender({ ...defaultProps, currentModelInfo: null });

    expect(result.current.runSettings.open).toBe(false);
  });

  it("keeps run settings open when the user opened it and then selects a model", () => {
    const { result, rerender } = renderAffordance();
    act(() => result.current.runSettings.onOpen());

    rerender({ ...defaultProps, currentModelInfo: makeCatalogModel({ name: "Sonnet" }) });

    expect(result.current.needsChatModel).toBe(false);
    expect(result.current.runSettings.open).toBe(true);
  });
});
