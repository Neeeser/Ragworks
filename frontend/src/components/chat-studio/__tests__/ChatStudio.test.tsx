import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatStudio } from "@/components/chat-studio/ChatStudio";
import * as apiModule from "@/lib/api";
import {
  altChatCompletionPayload,
  baseUser,
  basePromptDetails,
  chatCompletionPayload,
  chatMessages,
  collectionPromptDetails,
  collections,
  makeDocument,
  modelCatalog,
  pipeline,
  providerDirectory,
  sessions,
} from "@/test/fixtures";
import { setMockAuth } from "@/test/mocks";
import {
  getMockRouter,
  setMockParams,
  setMockPathname,
  setMockSearchParams,
} from "@/test/test-utils";

import type { ChatStreamHandlers } from "@/lib/api";
import type {
  ChatCompletionPayload,
  ChatRequestPayload,
  Document,
  PromptDetails,
  RunSettingsSectionKey,
} from "@/lib/types";
import type { ReactNode } from "react";

const CHAT_STUDIO_LOADED_KEY = "chatStudio.loaded";
const SEND_TURN_LABEL = "Send turn";
const TOOL_NAME = "collection.search";
const AUTH_TOKEN = "token";

vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "token" }),
);
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

// Children are mocked so the container's derived state can be observed through
// captured props; each kept test asserts a value that would change if the real
// container/hook logic regressed. api + auth remain mocked at the module edge.
let mockChatTimelineProps: Record<string, unknown> | null = null;
let mockHistoryPanelProps: Record<string, unknown> | null = null;
let mockTelemetryPanelProps: Record<string, unknown> | null = null;
let mockPromptOverlayProps: Record<string, unknown> | null = null;
let authValue = setMockAuth({ token: AUTH_TOKEN });

const documents: Document[] = [
  makeDocument({ collection_id: "col-1", content_type: "text/plain" }),
];

const setAuthState = (next: Parameters<typeof setMockAuth>[0]) => {
  authValue = setMockAuth({ token: AUTH_TOKEN, ...next });
};

const setQuery = (value: string) => setMockSearchParams(value);

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

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
  // TelemetryPanel takes grouped props (sections/prompts/collections/streaming/
  // model/provider/parameters/usage). Flatten them so assertions can read each
  // field directly regardless of its group.
  TelemetryPanel: (props: Record<string, Record<string, unknown> | unknown>) => {
    const groups = [
      "sections",
      "prompts",
      "collections",
      "streaming",
      "model",
      "provider",
      "parameters",
      "usage",
    ];
    const flattened: Record<string, unknown> = { onClose: props.onClose };
    for (const group of groups) {
      Object.assign(flattened, props[group] as Record<string, unknown>);
    }
    mockTelemetryPanelProps = flattened;
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
  api.listChatModels.mockResolvedValue({ models: modelCatalog, connection_errors: [] });
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
      _token: string,
      _payload: ChatRequestPayload,
      handlers?: ChatStreamHandlers,
    ): Promise<ChatCompletionPayload> => {
      handlers?.onToken?.("Stream");
      handlers?.onReasoning?.([{ type: "text", content: "Reason" }]);
      handlers?.onToolCall?.({ id: "tool-1", name: TOOL_NAME, arguments: { query: "alpha" } });
      handlers?.onToolResult?.({ id: "tool-1", name: TOOL_NAME, response: { ok: true } });
      handlers?.onError?.("Streaming warning");
      return chatCompletionPayload;
    },
  );
};

const typeAndSend = (value: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: SEND_TURN_LABEL }));
};

const firstStreamPayload = () =>
  api.streamChat.mock.calls[0][1] as unknown as Record<string, unknown>;

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
    authValue = setMockAuth({ token: AUTH_TOKEN });
    setupDefaultApiMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("composition & guards", () => {
    it("renders a loader while the initial session list is pending", async () => {
      api.listChatSessions.mockImplementation(() => new Promise(() => {}));

      render(<ChatStudio />);
      await flushPromises();

      expect(screen.getByTestId("loader")).toBeInTheDocument();
    });

    it("shows status messages when missing auth or configuration", async () => {
      setAuthState({ token: null, user: null });
      const { rerender } = render(<ChatStudio />);

      expect(screen.getByTestId("notification")).toHaveTextContent(
        "Sign in to access the chat studio.",
      );

      api.listConnections.mockResolvedValue([]);
      setAuthState({ user: baseUser });
      rerender(<ChatStudio />);
      await flushPromises();

      expect(screen.getByTestId("notification")).toHaveTextContent(
        "No chat provider is configured.",
      );
    });

    it("skips data loading while auth is loading", async () => {
      setAuthState({ loading: true });

      render(<ChatStudio />);
      await flushPromises();

      expect(api.listChatSessions).not.toHaveBeenCalled();
      expect(api.fetchCollections).not.toHaveBeenCalled();
      expect(api.listChatModels).not.toHaveBeenCalled();
    });

    it("loads collections and sends with tools even without a Pinecone key", async () => {
      // Pinecone is optional: collections may be pgvector-backed, so the
      // client never gates tools on the Pinecone key — the backend enforces
      // it only when a selected collection actually retrieves from Pinecone.
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setAuthState({ user: baseUser });

      render(<ChatStudio />);
      await flushPromises();

      expect(api.fetchCollections).toHaveBeenCalled();

      typeAndSend("Test");
      await waitFor(() => {
        expect(api.streamChat).toHaveBeenCalled();
      });
    });

    it("warns when sending without a selected model", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setAuthState({
        user: { ...baseUser, last_used_chat_model: null, last_used_tool_collection_ids: [] },
      });

      render(<ChatStudio />);
      typeAndSend("Test");

      await waitFor(() => {
        expect(screen.getByTestId("notification")).toHaveTextContent(
          "Select a chat model before sending a message.",
        );
      });
    });
  });

  describe("session & tool-collection derivation", () => {
    it("normalizes an array session param to the selected session id", async () => {
      setMockParams({ sessionId: ["session-1"] });

      render(<ChatStudio />);

      await waitFor(() => {
        expect(mockChatTimelineProps).not.toBeNull();
      });
      expect((mockChatTimelineProps as { selectedSessionId?: string }).selectedSessionId).toBe(
        "session-1",
      );
    });

    it("derives tool collections from URL params, dropping unknown ids", async () => {
      api.listChatSessions.mockResolvedValueOnce([]);
      setAuthState({ user: { ...baseUser, last_used_tool_collection_ids: [] } });

      const { rerender } = render(<ChatStudio />);
      await waitFor(() => {
        expect(mockTelemetryPanelProps).not.toBeNull();
      });

      setQuery("collections=col-2,missing");
      rerender(<ChatStudio />);

      await waitFor(() => {
        expect(
          (mockTelemetryPanelProps as { selectedToolCollectionIds?: string[] })
            .selectedToolCollectionIds,
        ).toEqual(["col-2"]);
      });
    });

    it("filters last-used tool collections against available collections", async () => {
      api.listChatSessions.mockResolvedValueOnce([]);
      setAuthState({ user: { ...baseUser, last_used_tool_collection_ids: ["col-1", "missing"] } });

      render(<ChatStudio />);

      await waitFor(() => {
        expect(
          (mockTelemetryPanelProps as { selectedToolCollectionIds?: string[] })
            .selectedToolCollectionIds,
        ).toEqual(["col-1"]);
      });
    });
  });

  describe("load error handling", () => {
    it("surfaces collection load errors", async () => {
      api.fetchCollections.mockRejectedValueOnce(new Error("Collections down"));

      render(<ChatStudio />);

      await waitFor(() => {
        expect(
          (mockTelemetryPanelProps as { collectionsError?: string | null }).collectionsError,
        ).toBe("Collections down");
      });
    });

    it("resets document and context counts when the document load fails", async () => {
      // The context window now comes from chat responses (model catalog), not
      // a pipeline fetch, so it simply starts at 0 for a fresh collection.
      api.fetchDocuments.mockRejectedValueOnce(new Error("Docs down"));

      render(<ChatStudio />);

      await waitFor(() => {
        expect(api.fetchDocuments).toHaveBeenCalled();
      });

      const telemetryProps = mockTelemetryPanelProps as {
        documentCount?: number;
        contextWindow?: number;
      };
      expect(telemetryProps.documentCount).toBe(0);
      expect(telemetryProps.contextWindow).toBe(0);
    });
  });

  describe("edit state", () => {
    it("opens and cancels an in-place message edit", async () => {
      render(<ChatStudio />);

      await waitFor(() => {
        expect(mockChatTimelineProps).not.toBeNull();
      });

      await act(async () => {
        (
          mockChatTimelineProps as { onEditStart?: (id: string, content: string) => void }
        ).onEditStart?.("message-1", "Draft");
      });

      await waitFor(() => {
        const props = mockChatTimelineProps as {
          editingMessageId?: string | null;
          editingDraft?: string;
        };
        expect(props.editingMessageId).toBe("message-1");
        expect(props.editingDraft).toBe("Draft");
      });

      await act(async () => {
        (mockChatTimelineProps as { onEditCancel?: () => void }).onEditCancel?.();
      });

      await waitFor(() => {
        const props = mockChatTimelineProps as {
          editingMessageId?: string | null;
          editingDraft?: string;
        };
        expect(props.editingMessageId).toBeNull();
        expect(props.editingDraft).toBe("");
      });
    });
  });

  describe("send flow & payload building", () => {
    it("creates a new session and routes to it on first send", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setAuthState({ user: { ...baseUser, last_used_tool_collection_ids: [] } });
      vi.stubGlobal("crypto", { randomUUID: undefined } as unknown as Crypto);

      render(<ChatStudio />);

      await waitFor(() => {
        expect(screen.getByText("Model One")).toBeInTheDocument();
      });

      getMockRouter().push.mockClear();
      typeAndSend("New chat");

      await waitFor(() => {
        expect(api.chat.mock.calls.length + api.streamChat.mock.calls.length).toBeGreaterThan(0);
      });
      expect(getMockRouter().push).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("surfaces streaming errors and resets live state", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: "session-1" });
      api.streamChat.mockRejectedValueOnce(new Error("Stream failed"));

      render(<ChatStudio />);
      await waitFor(() => {
        expect(api.getChatHistory).toHaveBeenCalled();
      });

      typeAndSend("Hello");

      await waitFor(() => {
        expect(screen.getByTestId("notification")).toHaveTextContent("Stream failed");
      });
    });

    it("flags incomplete streaming responses", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: "session-1" });
      api.streamChat.mockResolvedValueOnce(null as unknown as ChatCompletionPayload);

      render(<ChatStudio />);
      await waitFor(() => {
        expect(api.getChatHistory).toHaveBeenCalled();
      });

      typeAndSend("Hello");

      await waitFor(() => {
        expect(screen.getByTestId("notification")).toHaveTextContent(
          "Streaming response did not complete.",
        );
      });
    });

    it("sends supported boolean/string overrides and omits blank ones", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: "session-1" });

      render(<ChatStudio />);
      await waitFor(() => {
        expect(api.getChatHistory).toHaveBeenCalled();
      });

      typeAndSend("Hello");
      await waitFor(() => {
        expect(api.streamChat).toHaveBeenCalled();
      });

      const payload = firstStreamPayload();
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

    it("generates fallback ids for streaming tool calls without an id", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: "session-1" });
      api.streamChat.mockImplementationOnce(
        async (
          _token: string,
          _payload: ChatRequestPayload,
          handlers?: ChatStreamHandlers,
        ): Promise<ChatCompletionPayload> => {
          handlers?.onToolCall?.({ id: " ", name: TOOL_NAME, arguments: { q: "x" } });
          return chatCompletionPayload;
        },
      );

      render(<ChatStudio />);
      await waitFor(() => {
        expect(api.getChatHistory).toHaveBeenCalled();
      });

      typeAndSend("Hello");
      await waitFor(() => {
        expect(api.streamChat).toHaveBeenCalled();
      });

      const timelineProps = mockChatTimelineProps as { liveToolEvents?: Array<{ id?: string }> };
      expect(timelineProps?.liveToolEvents?.[0]?.id).toMatch(/^tool-/);
    });

    it("filters blank reasoning/response_format string overrides", async () => {
      const customSession = {
        ...sessions[0],
        id: "session-empty",
        parameter_overrides: { reasoning: "   ", response_format: "  " },
      };
      api.listChatSessions.mockResolvedValueOnce([customSession]);
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: customSession.id });

      render(<ChatStudio />);
      await waitFor(() => {
        expect(api.getChatHistory).toHaveBeenCalled();
      });

      typeAndSend("Hello");
      await waitFor(() => {
        expect(api.streamChat).toHaveBeenCalled();
      });

      expect(firstStreamPayload()).toEqual(
        expect.objectContaining({
          parameters: expect.not.objectContaining({
            reasoning: expect.anything(),
            response_format: expect.anything(),
          }),
        }),
      );
    });

    it("sends object-based reasoning overrides intact", async () => {
      const customSession = {
        ...sessions[0],
        id: "session-object",
        parameter_overrides: { reasoning: { effort: "high" } },
      };
      api.listChatSessions.mockResolvedValueOnce([customSession]);
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: customSession.id });

      render(<ChatStudio />);
      await waitFor(() => {
        expect(api.getChatHistory).toHaveBeenCalled();
      });

      typeAndSend("Hello");
      await waitFor(() => {
        expect(api.streamChat).toHaveBeenCalled();
      });

      expect(firstStreamPayload()).toEqual(
        expect.objectContaining({
          parameters: expect.objectContaining({ reasoning: { effort: "high" } }),
        }),
      );
    });

    it("stops an in-flight stream and branches from a message", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: "session-1" });

      let resolveStream: ((value: ChatCompletionPayload) => void) | null = null;
      api.streamChat.mockImplementation(
        async (
          _token: string,
          _payload: ChatRequestPayload,
          handlers?: ChatStreamHandlers,
        ): Promise<ChatCompletionPayload> => {
          handlers?.onToken?.("Stream");
          return new Promise<ChatCompletionPayload>((resolve) => {
            resolveStream = resolve;
          });
        },
      );

      render(<ChatStudio />);
      await waitFor(() => {
        expect(api.getChatHistory).toHaveBeenCalled();
      });

      typeAndSend("Hello there");
      await waitFor(() => {
        expect(api.streamChat).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await act(async () => {
        resolveStream?.(chatCompletionPayload);
      });
      api.streamChat.mockResolvedValue(chatCompletionPayload);

      const timelineProps = mockChatTimelineProps as Record<string, unknown>;
      await act(async () => {
        await (timelineProps.onBranchMessage as (id: string) => Promise<void>)("msg-2");
      });

      expect(api.branchChatSession).toHaveBeenCalled();
    });

    it("sends a non-streaming turn and deletes a session", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: "session-2" });
      setAuthState({ user: baseUser });
      api.chat.mockResolvedValue({ ...chatCompletionPayload, session: sessions[1] });

      render(<ChatStudio />);
      await waitFor(() => {
        expect(mockTelemetryPanelProps).toBeTruthy();
      });

      act(() => {
        (mockTelemetryPanelProps as { onStreamingToggle: (v: boolean) => void }).onStreamingToggle(
          false,
        );
      });

      typeAndSend("Question");
      await waitFor(() => {
        expect(api.chat).toHaveBeenCalled();
      });

      await act(async () => {
        await (mockHistoryPanelProps as { onDelete: (id: string) => Promise<void> }).onDelete(
          "session-2",
        );
      });

      expect(api.deleteChatSession).toHaveBeenCalledWith(AUTH_TOKEN, "session-2");
    });
  });

  describe("history & run settings", () => {
    it("refetches sessions with the collection filter and routes on session select", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: "session-1" });

      render(<ChatStudio />);
      await waitFor(() => {
        expect(mockHistoryPanelProps).not.toBeNull();
      });

      const historyProps = mockHistoryPanelProps as {
        onFilterChange: (ids: string[], include: boolean) => void;
        onSelect: (id: string) => void;
      };

      api.listChatSessions.mockClear();
      act(() => {
        historyProps.onFilterChange(["col-1"], true);
      });

      await waitFor(() => {
        expect(api.listChatSessions).toHaveBeenCalledWith(AUTH_TOKEN, {
          collectionIds: ["col-1"],
          includeUnassigned: true,
        });
      });

      getMockRouter().push.mockClear();
      await act(async () => {
        historyProps.onSelect("session-2");
      });
      expect(getMockRouter().push).toHaveBeenCalledWith(expect.stringContaining("session-2"));
    });

    it("toggles the provider preferences section", async () => {
      render(<ChatStudio />);
      await waitFor(() => {
        expect(mockTelemetryPanelProps).not.toBeNull();
      });

      const initialOpen = (mockTelemetryPanelProps as { providerPreferencesOpen?: boolean })
        .providerPreferencesOpen;

      await act(async () => {
        (
          mockTelemetryPanelProps as { onProviderPreferencesToggle?: () => void }
        ).onProviderPreferencesToggle?.();
      });

      await waitFor(() => {
        expect(
          (mockTelemetryPanelProps as { providerPreferencesOpen?: boolean })
            .providerPreferencesOpen,
        ).toBe(!initialOpen);
      });
    });

    it("persists a debounced run settings order change and refreshes the profile", async () => {
      vi.useFakeTimers();
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: "session-1" });

      render(<ChatStudio />);
      await flushPromises();

      const telemetryProps = mockTelemetryPanelProps as {
        sectionOrder: string[];
        onSectionOrderChange: (v: string[]) => void;
      };
      const nextOrder = [...telemetryProps.sectionOrder].reverse();

      act(() => {
        telemetryProps.onSectionOrderChange(nextOrder);
      });
      vi.advanceTimersByTime(600);
      await flushPromises();

      expect(api.updateRunSettingsOrder).toHaveBeenCalledWith(AUTH_TOKEN, nextOrder);
      expect(authValue.refreshProfile).toHaveBeenCalled();
    });

    it("notifies when saving the run settings order fails", async () => {
      api.updateRunSettingsOrder.mockRejectedValueOnce(new Error("Save failed"));

      render(<ChatStudio />);
      await waitFor(() => {
        expect(mockTelemetryPanelProps).not.toBeNull();
      });

      const reversed = [
        ...(baseUser.run_settings_order ?? []),
      ].reverse() as RunSettingsSectionKey[];

      vi.useFakeTimers();
      act(() => {
        (
          mockTelemetryPanelProps as {
            onSectionOrderChange?: (order: RunSettingsSectionKey[]) => void;
          }
        ).onSectionOrderChange?.(reversed);
      });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      await flushPromises();

      expect(screen.getByTestId("notification")).toHaveTextContent("Save failed");
    });

    it("saves prompt edits from the prompt editor overlay", async () => {
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      setMockParams({ sessionId: "session-1" });

      render(<ChatStudio />);
      await waitFor(() => {
        expect(mockTelemetryPanelProps).not.toBeNull();
      });

      act(() => {
        (mockTelemetryPanelProps as { onPromptEdit: () => void }).onPromptEdit();
      });
      await waitFor(() => {
        expect(screen.getByTestId("prompt-textarea")).toBeInTheDocument();
      });

      act(() => {
        (
          mockPromptOverlayProps as { onDraftChange: (section: string, value: string) => void }
        ).onDraftChange("base", "Draft base");
      });

      // Re-read the freshly captured props so onSave closes over the updated draft.
      await act(async () => {
        await (mockPromptOverlayProps as { onSave: (section: string) => Promise<void> }).onSave(
          "base",
        );
      });

      expect(api.updateBasePrompt).toHaveBeenCalledWith(AUTH_TOKEN, "Draft base");
    });
  });

  describe("responsive panels", () => {
    it("opens the run settings and history panels in overlay mode", async () => {
      window.innerWidth = 800;
      window.sessionStorage.setItem(CHAT_STUDIO_LOADED_KEY, "true");
      window.localStorage.setItem("chat.historyOpen", "true");
      window.localStorage.setItem("chat.telemetryOpen", "true");
      setMockParams({ sessionId: "session-1" });

      render(<ChatStudio />);
      await waitFor(() => {
        expect(mockChatTimelineProps).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: "Open run settings" }));
      await waitFor(() => {
        expect(screen.getByTestId("telemetry-panel")).toBeInTheDocument();
      });

      const openHistoryButton = await screen.findByRole("button", { name: "Open history" });
      fireEvent.click(openHistoryButton);
      expect(screen.getByTestId("history-panel")).toBeInTheDocument();
    });
  });
});
