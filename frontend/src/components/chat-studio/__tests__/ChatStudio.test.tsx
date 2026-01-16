import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatStudio } from "@/components/chat-studio/ChatStudio";
import {
  getMockRouter,
  setMockParams,
  setMockPathname,
  setMockSearchParams,
} from "@/test/test-utils";

import {
  altChatCompletionPayload,
  basePromptDetails,
  baseUser,
  chatCompletionPayload,
  chatMessages,
  collectionPromptDetails,
  collections,
  modelCatalog,
  pipeline,
  providerDirectory,
  sessions,
} from "./fixtures";

import type {
  ChatCompletionPayload,
  Document,
  PromptDetails,
  RunSettingsSectionKey,
  User,
} from "@/lib/types";
import type { ReactNode } from "react";

const CHAT_STUDIO_LOADED_KEY = "chatStudio.loaded";
const SEND_TURN_LABEL = "Send turn";
const TOOL_NAME = "collection.search";

let mockAuthState: {
  token: string | null;
  user: User | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
} = {
  token: "token",
  user: baseUser,
  loading: false,
  refreshProfile: vi.fn(),
};

const api = {
  branchChatSession: vi.fn(),
  chat: vi.fn(),
  deleteChatSession: vi.fn(),
  fetchCollections: vi.fn(),
  fetchDocuments: vi.fn(),
  fetchPipeline: vi.fn(),
  getBasePrompt: vi.fn(),
  getChatHistory: vi.fn(),
  getCollectionPrompt: vi.fn(),
  listChatSessions: vi.fn(),
  listModelEndpoints: vi.fn(),
  listModels: vi.fn(),
  streamChat: vi.fn(),
  updateRunSettingsOrder: vi.fn(),
  updateBasePrompt: vi.fn(),
  updateCollectionPrompt: vi.fn(),
};

let mockChatTimelineProps: Record<string, unknown> | null = null;
let mockHistoryPanelProps: Record<string, unknown> | null = null;
let mockTelemetryPanelProps: Record<string, unknown> | null = null;
let mockPromptOverlayProps: Record<string, unknown> | null = null;

const documents: Document[] = [
  {
    id: "doc-1",
    collection_id: "col-1",
    name: "Doc",
    content_type: "text/plain",
    status: "ready",
    num_chunks: 1,
    num_tokens: 10,
    chunk_size: 256,
    chunk_overlap: 0,
    chunk_strategy: "token",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
  },
];

const setAuthState = (next: Partial<typeof mockAuthState>) => {
  mockAuthState = {
    ...mockAuthState,
    ...next,
  };
};

const setQuery = (value: string) => {
  setMockSearchParams(value);
};

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => mockAuthState,
}));

vi.mock("@/lib/api", () => ({
  branchChatSession: (...args: unknown[]) => api.branchChatSession(...args),
  chat: (...args: unknown[]) => api.chat(...args),
  deleteChatSession: (...args: unknown[]) => api.deleteChatSession(...args),
  fetchCollections: (...args: unknown[]) => api.fetchCollections(...args),
  fetchDocuments: (...args: unknown[]) => api.fetchDocuments(...args),
  fetchPipeline: (...args: unknown[]) => api.fetchPipeline(...args),
  getBasePrompt: (...args: unknown[]) => api.getBasePrompt(...args),
  getChatHistory: (...args: unknown[]) => api.getChatHistory(...args),
  getCollectionPrompt: (...args: unknown[]) => api.getCollectionPrompt(...args),
  listChatSessions: (...args: unknown[]) => api.listChatSessions(...args),
  listModelEndpoints: (...args: unknown[]) => api.listModelEndpoints(...args),
  listModels: (...args: unknown[]) => api.listModels(...args),
  streamChat: (...args: unknown[]) => api.streamChat(...args),
  updateRunSettingsOrder: (...args: unknown[]) => api.updateRunSettingsOrder(...args),
  updateBasePrompt: (...args: unknown[]) => api.updateBasePrompt(...args),
  updateCollectionPrompt: (...args: unknown[]) => api.updateCollectionPrompt(...args),
}));

vi.mock("@/components/chat-studio/ChatTimeline", () => ({
  ChatTimeline: (props: Record<string, unknown>) => {
    mockChatTimelineProps = props;
    return <div data-testid="chat-timeline" />;
  },
}));

vi.mock("@/components/chat-studio/HistoryPanel", () => ({
  HistoryPanel: (props: Record<string, unknown>) => {
    mockHistoryPanelProps = props;
    return <div data-testid="history-panel" />;
  },
}));

vi.mock("@/components/chat-studio/telemetry/TelemetryPanel", () => ({
  TelemetryPanel: (props: Record<string, unknown>) => {
    mockTelemetryPanelProps = props;
    return <div data-testid="telemetry-panel" />;
  },
}));

vi.mock("@/components/chat-studio/PromptEditorOverlay", () => ({
  PromptEditorOverlay: (props: Record<string, unknown>) => {
    mockPromptOverlayProps = props;
    if (!props.isOpen) {
      return <div data-testid="prompt-editor" />;
    }
    const inputRef = props.inputRef as { current: HTMLTextAreaElement | null };
    return (
      <div data-testid="prompt-editor">
        <textarea ref={inputRef} data-testid="prompt-textarea" />
      </div>
    );
  },
}));

vi.mock("@/components/ui/notification", () => ({
  Notification: ({
    message,
    title,
    onDismiss,
  }: {
    message: string;
    title?: string;
    onDismiss?: () => void;
  }) => (
    <div data-testid="notification">
      <span>{title}</span>
      <span>{message}</span>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/loader", () => ({
  Loader: () => <div data-testid="loader" />,
}));

vi.mock("@/components/ui/panel", () => ({
  GlassCard: ({ children }: { children: ReactNode }) => (
    <div data-testid="glass-card">{children}</div>
  ),
}));

const setupDefaultApiMocks = () => {
  api.branchChatSession.mockResolvedValue({
    session: altChatCompletionPayload.session,
    messages: altChatCompletionPayload.messages,
  });
  api.chat.mockResolvedValue(chatCompletionPayload);
  api.deleteChatSession.mockResolvedValue(undefined);
  api.fetchCollections.mockResolvedValue(collections);
  api.fetchDocuments.mockResolvedValue(documents);
  api.fetchPipeline.mockResolvedValue(pipeline);
  api.getBasePrompt.mockResolvedValue(basePromptDetails);
  api.getChatHistory.mockResolvedValue(chatMessages);
  api.getCollectionPrompt.mockResolvedValue(collectionPromptDetails);
  api.listChatSessions.mockResolvedValue(sessions);
  api.listModelEndpoints.mockResolvedValue({ data: providerDirectory });
  api.listModels.mockResolvedValue(modelCatalog);
  api.updateRunSettingsOrder.mockResolvedValue(baseUser);
  api.updateBasePrompt.mockResolvedValue({
    ...basePromptDetails,
    template: "Updated base",
  } satisfies PromptDetails);
  api.updateCollectionPrompt.mockResolvedValue({
    ...collectionPromptDetails,
    template: "Updated collection",
  } satisfies PromptDetails);
  api.streamChat.mockImplementation(
    async (
      _payload: unknown,
      _token: string,
      handlers: {
        onToken?: (token: string) => void;
        onReasoning?: (segments: unknown) => void;
        onToolCall?: (event: Record<string, unknown>) => void;
        onToolResult?: (event: Record<string, unknown>) => void;
        onError?: (message: string) => void;
      },
    ): Promise<ChatCompletionPayload> => {
      handlers.onToken?.("Stream");
      handlers.onReasoning?.([{ type: "text", content: "Reason" }]);
      handlers.onToolCall?.({
        id: "tool-1",
        name: TOOL_NAME,
        arguments: { query: "alpha" },
      });
      handlers.onToolResult?.({
        id: "tool-1",
        name: TOOL_NAME,
        response: { ok: true },
      });
      handlers.onError?.("Streaming warning");
      return chatCompletionPayload;
    },
  );
};

describe("ChatStudio", () => {
  beforeEach(() => {
    const router = getMockRouter();
    router.push.mockReset();
    router.replace.mockReset();
    router.prefetch.mockReset();
    router.refresh.mockReset();
    setMockPathname("/chat");
    setQuery("");
    setMockParams({});
    mockChatTimelineProps = null;
    mockHistoryPanelProps = null;
    mockTelemetryPanelProps = null;
    mockPromptOverlayProps = null;
    window.innerWidth = 1600;
    window.innerHeight = 900;
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockAuthState = {
      token: "token",
      user: baseUser,
      loading: false,
      refreshProfile: vi.fn(),
    };
    Object.values(api).forEach((mockFn) => {
      mockFn.mockReset();
    });
    setupDefaultApiMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a loader while auth is loading", async () => {
    setAuthState({ loading: false });
    api.listChatSessions.mockImplementation(() => new Promise(() => {}));

    render(<ChatStudio />);
    await flushPromises();

    expect(screen.getByTestId("loader")).toBeInTheDocument();
  });

  it("shows status messages when missing auth or configuration", async () => {
    setAuthState({ token: null, user: null, loading: false });
    const { rerender } = render(<ChatStudio />);

    expect(screen.getByTestId("notification")).toHaveTextContent(
      "Sign in to access the chat studio.",
    );

    setAuthState({
      token: "token",
      user: {
        ...baseUser,
        openrouter_configured: false,
      },
    });

    rerender(<ChatStudio />);
    await flushPromises();

    expect(screen.getByTestId("notification")).toHaveTextContent(
      "OpenRouter API key is not configured.",
    );
  });

  it("handles array session params", async () => {
    setMockParams({ sessionId: ["session-1"] });

    render(<ChatStudio />);

    await waitFor(() => {
      expect(mockChatTimelineProps).not.toBeNull();
    });

    const timelineProps = mockChatTimelineProps as { selectedSessionId?: string | null };
    expect(timelineProps.selectedSessionId).toBe("session-1");
  });

  it("updates tool collections from URL params when no session is selected", async () => {
    setMockParams({});
    setQuery("");
    api.listChatSessions.mockResolvedValueOnce([]);
    setAuthState({
      user: {
        ...baseUser,
        last_used_tool_collection_ids: [],
      },
    });

    const { rerender } = render(<ChatStudio />);

    await waitFor(() => {
      expect(mockTelemetryPanelProps).not.toBeNull();
    });

    setQuery("collections=col-2,missing");
    rerender(<ChatStudio />);

    await waitFor(() => {
      const telemetryProps = mockTelemetryPanelProps as { selectedToolCollectionIds?: string[] };
      expect(telemetryProps.selectedToolCollectionIds).toEqual(["col-2"]);
    });
  });

  it("filters last-used tool collections against available collections", async () => {
    setMockParams({});
    setQuery("");
    api.listChatSessions.mockResolvedValueOnce([]);
    setAuthState({
      user: {
        ...baseUser,
        last_used_tool_collection_ids: ["col-1", "missing"],
      },
    });

    render(<ChatStudio />);

    await waitFor(() => {
      const telemetryProps = mockTelemetryPanelProps as { selectedToolCollectionIds?: string[] };
      expect(telemetryProps.selectedToolCollectionIds).toEqual(["col-1"]);
    });
  });

  it("toggles edit cancel and provider preferences", async () => {
    render(<ChatStudio />);

    await waitFor(() => {
      expect(mockChatTimelineProps).not.toBeNull();
      expect(mockTelemetryPanelProps).not.toBeNull();
    });

    await act(async () => {
      (
        mockChatTimelineProps as { onEditStart?: (id: string, content: string) => void }
      ).onEditStart?.("message-1", "Draft");
    });

    await waitFor(() => {
      const timelineProps = mockChatTimelineProps as {
        editingMessageId?: string | null;
        editingDraft?: string;
      };
      expect(timelineProps.editingMessageId).toBe("message-1");
      expect(timelineProps.editingDraft).toBe("Draft");
    });

    await act(async () => {
      (mockChatTimelineProps as { onEditCancel?: () => void }).onEditCancel?.();
    });

    await waitFor(() => {
      const timelineProps = mockChatTimelineProps as {
        editingMessageId?: string | null;
        editingDraft?: string;
      };
      expect(timelineProps.editingMessageId).toBeNull();
      expect(timelineProps.editingDraft).toBe("");
    });

    const initialOpen = (mockTelemetryPanelProps as { providerPreferencesOpen?: boolean })
      .providerPreferencesOpen;

    await act(async () => {
      (
        mockTelemetryPanelProps as { onProviderPreferencesToggle?: () => void }
      ).onProviderPreferencesToggle?.();
    });

    await waitFor(() => {
      const telemetryProps = mockTelemetryPanelProps as { providerPreferencesOpen?: boolean };
      expect(telemetryProps.providerPreferencesOpen).toBe(!initialOpen);
    });
  });

  it("handles overlay telemetry toggles and cancels scroll frames", async () => {
    const originalWidth = window.innerWidth;
    const originalRAF = window.requestAnimationFrame;
    const originalCAF = window.cancelAnimationFrame;
    const cancelSpy = vi.fn();
    window.innerWidth = 1000;
    const requestSpy = vi.fn().mockReturnValue(123);
    window.requestAnimationFrame = requestSpy;
    window.cancelAnimationFrame = cancelSpy;
    window.localStorage.setItem("chat.telemetryOpen", "true");
    window.localStorage.setItem("chat.historyOpen", "false");

    render(<ChatStudio />);

    await waitFor(() => {
      expect(mockChatTimelineProps).not.toBeNull();
      expect(mockTelemetryPanelProps).not.toBeNull();
      expect(requestSpy).toHaveBeenCalled();
    });

    await act(async () => {
      (
        mockChatTimelineProps as { onEditStart?: (id: string, content: string) => void }
      ).onEditStart?.("message-1", "Draft");
    });

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalled();
    });

    await act(async () => {
      (
        mockTelemetryPanelProps as { onProviderPreferencesToggle?: () => void }
      ).onProviderPreferencesToggle?.();
    });

    window.innerWidth = originalWidth;
    window.requestAnimationFrame = originalRAF;
    window.cancelAnimationFrame = originalCAF;
  });

  it("loads data, toggles panels, and saves prompt edits", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: "session-1" });
    setQuery("collections=col-1,col-2");

    const { container } = render(<ChatStudio />);

    await waitFor(() => {
      expect(api.listChatSessions).toHaveBeenCalled();
      expect(api.fetchCollections).toHaveBeenCalled();
      expect(api.listModels).toHaveBeenCalled();
    });

    const scrollContainer = container.querySelector("div.scroll-smooth");
    expect(scrollContainer).toBeTruthy();
    if (scrollContainer) {
      Object.defineProperty(scrollContainer, "scrollHeight", { value: 200, configurable: true });
      Object.defineProperty(scrollContainer, "clientHeight", { value: 100, configurable: true });
      Object.defineProperty(scrollContainer, "scrollTop", {
        value: 0,
        writable: true,
        configurable: true,
      });
      scrollContainer.scrollTop = 0;
      fireEvent.scroll(scrollContainer);
      scrollContainer.scrollTop = 98;
      fireEvent.scroll(scrollContainer);
    }

    const telemetryProps = mockTelemetryPanelProps as Record<string, unknown>;
    expect(telemetryProps).toBeTruthy();

    act(() => {
      (telemetryProps.onToggleToolCollection as (value: string) => void)("col-2");
      (telemetryProps.onClearToolCollections as () => void)();
      (telemetryProps.onStreamingToggle as (value: boolean) => void)(false);
      (telemetryProps.onSelectModel as (value: string) => void)("model-2");
      (telemetryProps.onModelSearchChange as (value: string) => void)("Model");
      (telemetryProps.onModelSortChange as (value: string) => void)("price");
      (telemetryProps.resetProviderPreferences as () => void)();
      (telemetryProps.resetAllParameters as () => void)();
      (telemetryProps.handleNumberParameterChange as (key: string, value: string) => void)(
        "temperature",
        "0.7",
      );
      (telemetryProps.handleNumberParameterChange as (key: string, value: string) => void)(
        "temperature",
        "",
      );
      (telemetryProps.handleBooleanParameterChange as (key: string, value: boolean) => void)(
        "logit_bias",
        true,
      );
      (telemetryProps.handleTextParameterChange as (key: string, value: string) => void)(
        "user",
        "test",
      );
      (telemetryProps.handleSelectParameterChange as (key: string, value: string) => void)(
        "reasoning",
        "low",
      );
      (telemetryProps.handleClearParameter as (key: string) => void)("reasoning");
      (telemetryProps.formatDefaultParameter as (key: string) => string | null)("temperature");
    });

    act(() => {
      (telemetryProps.onPromptEdit as () => void)();
    });

    await waitFor(() => {
      expect(screen.getByTestId("prompt-textarea")).toBeInTheDocument();
    });

    const promptProps = mockPromptOverlayProps as Record<string, unknown>;
    expect(promptProps).toBeTruthy();

    act(() => {
      (promptProps.onSelectSection as (value: string) => void)("base");
      (promptProps.onDraftChange as (sectionId: string, value: string) => void)("base", "Draft");
      (promptProps.onInsertVariable as (sectionId: string, variableName: string) => void)(
        "base",
        "user",
      );
      (promptProps.onReset as (sectionId: string) => void)("base");
    });

    await act(async () => {
      await (promptProps.onSave as (sectionId: string) => Promise<void>)("base");
      await (promptProps.onSave as (sectionId: string) => Promise<void>)("col-1");
    });

    act(() => {
      (promptProps.onClose as () => void)();
    });

    act(() => {
      (telemetryProps.onExportChatHistory as () => void)();
    });

    const historyProps = mockHistoryPanelProps as Record<string, unknown>;
    expect(historyProps).toBeTruthy();

    api.listChatSessions.mockClear();
    act(() => {
      (historyProps.onFilterChange as (ids: string[], include: boolean) => void)(["col-1"], true);
    });

    await waitFor(() => {
      expect(api.listChatSessions).toHaveBeenCalledWith("token", {
        collectionIds: ["col-1"],
        includeUnassigned: true,
      });
    });

    getMockRouter().push.mockClear();
    act(() => {
      (historyProps.onSelect as (sessionId: string) => void)("session-1");
      (historyProps.onNewChat as () => void)();
    });

    expect(getMockRouter().push).toHaveBeenCalled();
  });

  it("saves run settings order changes", async () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: "session-1" });

    render(<ChatStudio />);

    await flushPromises();

    const telemetryProps = mockTelemetryPanelProps as Record<string, unknown>;
    expect(telemetryProps).toBeTruthy();
    const currentOrder = telemetryProps.sectionOrder as string[];
    const nextOrder = [...currentOrder].reverse();

    act(() => {
      (telemetryProps.onSectionOrderChange as (value: string[]) => void)(nextOrder);
    });

    vi.advanceTimersByTime(600);
    await flushPromises();

    expect(api.updateRunSettingsOrder).toHaveBeenCalledWith("token", nextOrder);
    expect(mockAuthState.refreshProfile).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("handles run settings order save failures", async () => {
    api.updateRunSettingsOrder.mockRejectedValueOnce(new Error("Save failed"));

    render(<ChatStudio />);

    await waitFor(() => {
      expect(mockTelemetryPanelProps).not.toBeNull();
    });

    const telemetryProps = mockTelemetryPanelProps as {
      onSectionOrderChange?: (order: RunSettingsSectionKey[]) => void;
    };
    const reversed = [...baseUser.run_settings_order].reverse() as RunSettingsSectionKey[];

    vi.useFakeTimers();
    act(() => {
      telemetryProps.onSectionOrderChange?.(reversed);
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });
    await flushPromises();

    expect(screen.getByTestId("notification")).toHaveTextContent("Save failed");
  });

  it("skips data loading while auth is loading", async () => {
    setAuthState({ loading: true });

    render(<ChatStudio />);
    await flushPromises();

    expect(api.listChatSessions).not.toHaveBeenCalled();
    expect(api.fetchCollections).not.toHaveBeenCalled();
    expect(api.listModels).not.toHaveBeenCalled();
  });

  it("surfaces collection load errors", async () => {
    api.fetchCollections.mockRejectedValueOnce(new Error("Collections down"));

    render(<ChatStudio />);

    await waitFor(() => {
      const telemetryProps = mockTelemetryPanelProps as { collectionsError?: string | null };
      expect(telemetryProps.collectionsError).toBe("Collections down");
    });
  });

  it("resets counts when document or pipeline loads fail", async () => {
    api.fetchDocuments.mockRejectedValueOnce(new Error("Docs down"));
    api.fetchPipeline.mockRejectedValueOnce(new Error("Pipeline down"));

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.fetchDocuments).toHaveBeenCalled();
      expect(api.fetchPipeline).toHaveBeenCalled();
    });

    const telemetryProps = mockTelemetryPanelProps as {
      documentCount?: number;
      contextWindow?: number;
    };
    expect(telemetryProps.documentCount).toBe(0);
    expect(telemetryProps.contextWindow).toBe(0);
  });

  it("creates new sessions with fallback ids", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({});
    setAuthState({
      user: {
        ...baseUser,
        last_used_tool_collection_ids: [],
      },
    });

    vi.stubGlobal("crypto", {
      randomUUID: undefined,
    } as Crypto);

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.listChatSessions).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("Model One")).toBeInTheDocument();
    });

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "New chat" } });

    getMockRouter().push.mockClear();
    const sendButton = screen.getByRole("button", { name: SEND_TURN_LABEL });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(api.chat.mock.calls.length + api.streamChat.mock.calls.length).toBeGreaterThan(0);
    });

    expect(getMockRouter().push).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("opens model routing from the timeline selector", async () => {
    render(<ChatStudio />);

    await waitFor(() => {
      expect(mockChatTimelineProps).not.toBeNull();
      expect(mockTelemetryPanelProps).not.toBeNull();
    });

    await act(async () => {
      (mockChatTimelineProps as { onModelSelect?: () => void }).onModelSelect?.();
    });

    await waitFor(() => {
      const telemetryProps = mockTelemetryPanelProps as { modelSelectorOpen?: boolean };
      expect(telemetryProps.modelSelectorOpen).toBe(true);
    });
  });

  it("surfaces streaming errors and resets live state", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: "session-1" });
    api.streamChat.mockRejectedValueOnce(new Error("Stream failed"));

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.getChatHistory).toHaveBeenCalled();
      expect(api.listChatSessions).toHaveBeenCalled();
    });

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Hello" } });

    fireEvent.click(screen.getByRole("button", { name: SEND_TURN_LABEL }));

    await waitFor(() => {
      expect(screen.getByTestId("notification")).toHaveTextContent("Stream failed");
    });
  });

  it("assigns fallback tool phases when tool results arrive without calls", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: "session-1" });
    api.streamChat.mockImplementationOnce(
      async (
        _payload: unknown,
        _token: string,
        handlers: {
          onToolResult?: (event: Record<string, unknown>) => void;
        },
      ) => {
        handlers.onToolResult?.({ id: " ", name: TOOL_NAME, response: { ok: true } });
        return chatCompletionPayload;
      },
    );

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.getChatHistory).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: SEND_TURN_LABEL }));

    await waitFor(() => {
      expect(api.streamChat).toHaveBeenCalled();
    });

    const timelineProps = mockChatTimelineProps as { liveToolPhaseById?: Record<string, number> };
    expect(timelineProps?.liveToolPhaseById).toEqual(expect.any(Object));
  });

  it("flags incomplete streaming responses", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: "session-1" });
    api.streamChat.mockResolvedValueOnce(null as unknown as ChatCompletionPayload);

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.getChatHistory).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: SEND_TURN_LABEL }));

    await waitFor(() => {
      expect(screen.getByTestId("notification")).toHaveTextContent(
        "Streaming response did not complete.",
      );
    });
  });

  it("sends boolean parameter overrides for supported params", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: "session-1" });

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.getChatHistory).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: SEND_TURN_LABEL }));

    await waitFor(() => {
      expect(api.streamChat).toHaveBeenCalled();
    });

    const [payload] = api.streamChat.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual(
      expect.objectContaining({
        parameters: expect.objectContaining({ logprobs: true, stop: "END" }),
      }),
    );
    expect(payload).toEqual(
      expect.objectContaining({
        parameters: expect.not.objectContaining({ response_format: expect.anything() }),
      }),
    );
  });

  it("creates fallback ids for streaming tool calls", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: "session-1" });

    api.streamChat.mockImplementationOnce(
      async (
        _payload: unknown,
        _token: string,
        handlers: {
          onToolCall?: (event: Record<string, unknown>) => void;
        },
      ): Promise<ChatCompletionPayload> => {
        handlers.onToolCall?.({ id: " ", name: TOOL_NAME, arguments: { q: "x" } });
        return chatCompletionPayload;
      },
    );

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.getChatHistory).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: SEND_TURN_LABEL }));

    await waitFor(() => {
      expect(api.streamChat).toHaveBeenCalled();
    });

    const timelineProps = mockChatTimelineProps as { liveToolEvents?: Array<{ id?: string }> };
    const toolId = timelineProps?.liveToolEvents?.[0]?.id;
    expect(toolId).toMatch(/^tool-/);
  });

  it("filters empty reasoning and string overrides", async () => {
    const customSession = {
      ...sessions[0],
      id: "session-empty",
      parameter_overrides: {
        reasoning: "   ",
        response_format: "  ",
      },
    };
    api.listChatSessions.mockResolvedValueOnce([customSession]);
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: customSession.id });

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.getChatHistory).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: SEND_TURN_LABEL }));

    await waitFor(() => {
      expect(api.streamChat).toHaveBeenCalled();
    });

    const [payload] = api.streamChat.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual(
      expect.objectContaining({
        parameters: expect.not.objectContaining({
          reasoning: expect.anything(),
          response_format: expect.anything(),
        }),
      }),
    );
  });

  it("sends object-based reasoning overrides", async () => {
    const customSession = {
      ...sessions[0],
      id: "session-object",
      parameter_overrides: {
        reasoning: { effort: "high" },
      },
    };
    api.listChatSessions.mockResolvedValueOnce([customSession]);
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: customSession.id });

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.getChatHistory).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: SEND_TURN_LABEL }));

    await waitFor(() => {
      expect(api.streamChat).toHaveBeenCalled();
    });

    const [payload] = api.streamChat.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual(
      expect.objectContaining({
        parameters: expect.objectContaining({ reasoning: { effort: "high" } }),
      }),
    );
  });

  it("sends messages and handles streaming, stop, and edits", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: "session-1" });

    let resolveStream: ((value: ChatCompletionPayload) => void) | null = null;
    api.streamChat.mockImplementation(
      async (
        _payload: unknown,
        _token: string,
        handlers: {
          onToken?: (token: string) => void;
          onReasoning?: (segments: unknown) => void;
          onToolCall?: (event: Record<string, unknown>) => void;
          onToolResult?: (event: Record<string, unknown>) => void;
        },
      ): Promise<ChatCompletionPayload> => {
        handlers.onToken?.("Stream");
        handlers.onReasoning?.([{ type: "text", content: "Reason" }]);
        handlers.onToolCall?.({
          id: "tool-1",
          name: TOOL_NAME,
          arguments: { query: "alpha" },
        });
        handlers.onToolResult?.({
          id: "tool-1",
          name: TOOL_NAME,
          response: { ok: true },
        });
        return new Promise<ChatCompletionPayload>((resolve) => {
          resolveStream = resolve;
        });
      },
    );

    render(<ChatStudio />);

    await waitFor(() => {
      expect(api.getChatHistory).toHaveBeenCalled();
      expect(api.listChatSessions).toHaveBeenCalled();
    });

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Hello there" } });

    const sendButton = screen.getByRole("button", { name: SEND_TURN_LABEL });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(api.streamChat).toHaveBeenCalled();
    });

    const stopButton = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);

    await act(async () => {
      resolveStream?.(chatCompletionPayload);
    });

    api.streamChat.mockResolvedValue(chatCompletionPayload);

    const timelineProps = mockChatTimelineProps as Record<string, unknown>;
    const overrideTarget = document.createElement("div");
    overrideTarget.id = "telemetry-model-routing";
    document.body.appendChild(overrideTarget);
    act(() => {
      (timelineProps.onEditStart as (messageId: string, content: string) => void)("msg-2", "Hello");
      (timelineProps.onEditChange as (value: string) => void)("Edited message");
      (timelineProps.onReasoningToggle as (messageId: string, isOpen: boolean) => void)(
        "msg-3",
        true,
      );
      (timelineProps.onOverrideSelect as (sectionId: string) => void)("telemetry-model-routing");
      (timelineProps.onNavigateToSession as (sessionId: string) => void)("session-2");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    await act(async () => {
      await (timelineProps.onEditSubmit as () => Promise<void>)();
      await (timelineProps.onRetryAssistant as (messageId: string) => Promise<void>)("msg-3");
    });

    await act(async () => {
      await (timelineProps.onBranchMessage as (messageId: string) => Promise<void>)("msg-2");
    });

    expect(api.branchChatSession).toHaveBeenCalled();

    act(() => {
      (timelineProps.onEditStart as (messageId: string, content: string) => void)("msg-2", "Hello");
      (timelineProps.onEditChange as (value: string) => void)(" ");
    });

    await act(async () => {
      await (timelineProps.onEditSubmit as () => Promise<void>)();
    });
  });

  it("handles non-streaming mutations and delete flows", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({ sessionId: "session-2" });
    setAuthState({
      user: {
        ...baseUser,
        pinecone_configured: false,
      },
    });

    api.chat.mockResolvedValue({
      ...chatCompletionPayload,
      session: sessions[1],
    });

    render(<ChatStudio />);

    await waitFor(() => {
      expect(mockTelemetryPanelProps).toBeTruthy();
    });

    const telemetryProps = mockTelemetryPanelProps as Record<string, unknown>;
    act(() => {
      (telemetryProps.onStreamingToggle as (value: boolean) => void)(false);
    });

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Question" } });

    const sendButton = screen.getByRole("button", { name: SEND_TURN_LABEL });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(api.chat).toHaveBeenCalled();
    });

    const historyProps = mockHistoryPanelProps as Record<string, unknown>;

    await act(async () => {
      await (historyProps.onDelete as (sessionId: string) => Promise<void>)("session-2");
    });

    expect(api.deleteChatSession).toHaveBeenCalledWith("session-2", "token");
  });

  it("guards against missing tool keys", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({});
    setAuthState({
      user: {
        ...baseUser,
        pinecone_configured: false,
      },
    });

    render(<ChatStudio />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Test" } });

    const sendButton = screen.getByRole("button", { name: SEND_TURN_LABEL });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByTestId("notification")).toHaveTextContent(
        "Add your Pinecone API key in Settings to enable collection tools.",
      );
    });
  });

  it("guards against missing model", async () => {
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    setMockParams({});
    setAuthState({
      user: {
        ...baseUser,
        last_used_chat_model: null,
        last_used_tool_collection_ids: [],
      },
    });

    render(<ChatStudio />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Test" } });

    const sendButton = screen.getByRole("button", { name: SEND_TURN_LABEL });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByTestId("notification")).toHaveTextContent(
        "Select a chat model before sending a message.",
      );
    });
  });

  it("supports overlay mode and scroll controls", async () => {
    window.innerWidth = 800;
    window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
    window.localStorage.setItem("chat.historyOpen", "true");
    window.localStorage.setItem("chat.telemetryOpen", "true");
    setMockParams({ sessionId: "session-1" });

    render(<ChatStudio />);

    await waitFor(() => {
      expect(mockChatTimelineProps).toBeTruthy();
    });

    const timelineProps = mockChatTimelineProps as Record<string, unknown>;
    act(() => {
      (timelineProps.onEditStart as (messageId: string, content: string) => void)("msg-2", "Hello");
    });

    const followButton = screen.getByRole("button", { name: "Scroll to latest message" });
    fireEvent.click(followButton);

    const openTelemetryButton = screen.getByRole("button", { name: "Open run settings" });
    fireEvent.click(openTelemetryButton);

    await waitFor(() => {
      expect(screen.getByTestId("telemetry-panel")).toBeInTheDocument();
    });

    const openHistoryButton = await screen.findByRole("button", { name: "Open history" });
    fireEvent.click(openHistoryButton);
  });
});
