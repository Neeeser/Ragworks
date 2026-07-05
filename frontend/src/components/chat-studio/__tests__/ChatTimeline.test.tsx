import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { markdownComponents } from "@/components/chat-studio/chat-utils";
import { ChatTimeline } from "@/components/chat-studio/ChatTimeline";

import type { ChatEntry } from "@/components/chat-studio/chat-types";
import type { ChatMessage, ReasoningTraceSegment, ToolCallTrace } from "@/lib/types";

vi.mock("@/components/chat-studio/Tooling", () => ({
  ToolCallBubble: ({ label, footer }: { label: string; footer?: React.ReactNode }) => (
    <div data-testid={TOOL_BUBBLE_TESTID}>
      <span>{label}</span>
      {footer}
    </div>
  ),
}));

vi.mock("@/components/ui/collapsible-reasoning", () => ({
  CollapsibleReasoning: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div data-testid="reasoning">
      {title}
      {subtitle ? ` ${subtitle}` : ""}
    </div>
  ),
}));

vi.mock("@/components/ui/typing-animation", () => ({
  TypingAnimation: () => <div data-testid="typing" />,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

type ChatTimelineProps = React.ComponentProps<typeof ChatTimeline>;

const baseTimestamp = "2024-01-01T00:00:00.000Z";
const assistantEntryId = "entry-assistant";
const userEntryId = "entry-user";
const TOOL_BUBBLE_TESTID = "tool-bubble";
const ORIGINAL_CHAT_TITLE = "Original chat";
const ASSISTANT_REASONING_TEXT = "Assistant reasoning";

const buildMessage = (
  role: ChatMessage["role"],
  content: string,
  overrides?: Partial<ChatMessage>,
): ChatMessage => ({
  id: `msg-${role}`,
  session_id: "session-1",
  role,
  content,
  created_at: baseTimestamp,
  ...overrides,
});

const baseProps = (overrides: Partial<ChatTimelineProps> = {}): ChatTimelineProps => ({
  modelLabel: "Model",
  onModelSelect: vi.fn(),
  chatEntryOrder: [],
  chatEntryMap: new Map(),
  finalStreamAssistantId: null,
  streamEntryKeyMap: {},
  liveToolEvents: [],
  selectedSessionId: null,
  sending: false,
  editingMessageId: null,
  editingDraft: "",
  onEditChange: vi.fn(),
  onEditStart: vi.fn(),
  onEditCancel: vi.fn(),
  onEditSubmit: vi.fn(),
  onRetryAssistant: vi.fn(),
  onBranchMessage: vi.fn(),
  markdownComponents,
  overrideSections: [],
  onOverrideSelect: vi.fn(),
  liveResponse: "",
  hasLiveText: false,
  liveResponseAnimationKey: 0,
  activeStreamEntryKey: null,
  shouldShowStreamingReasoningBubble: false,
  liveReasoningAnimationKey: 0,
  liveReasoningBlocks: [],
  liveReasoningPhase: 0,
  liveToolOrder: [],
  liveToolPhaseById: {},
  liveReasoningDisplaySegments: [],
  showStreamingBubble: false,
  branchedFromSessionId: null,
  branchedFromSessionTitle: null,
  branchedFromMessageId: null,
  branchedFromOrigin: "manual",
  onNavigateToSession: vi.fn(),
  ...overrides,
});

describe("ChatTimeline", () => {
  it("renders empty state with overrides", () => {
    const onModelSelect = vi.fn();
    const onOverrideSelect = vi.fn();

    render(
      <ChatTimeline
        {...baseProps({
          onModelSelect,
          overrideSections: [{ id: "system", label: "System" }],
          onOverrideSelect,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Model/ }));
    expect(onModelSelect).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(onOverrideSelect).toHaveBeenCalledWith("system");
  });

  it("renders empty state without overrides", () => {
    render(<ChatTimeline {...baseProps({ overrideSections: [] })} />);

    expect(screen.getByText("No overrides yet")).toBeInTheDocument();
  });

  it("renders message entries and edit actions", () => {
    const userMessage = buildMessage("user", "Hi", { id: "u1" });
    const assistantMessage = buildMessage("assistant", "Hello", { id: "a1" });

    const entries: ChatEntry[] = [
      {
        id: userEntryId,
        type: "user",
        message: userMessage,
        content: userMessage.content,
        createdAt: userMessage.created_at,
      },
      {
        id: assistantEntryId,
        type: "assistant",
        message: assistantMessage,
        content: assistantMessage.content,
        createdAt: assistantMessage.created_at,
      },
    ];

    const chatEntryMap = new Map(entries.map((entry) => [entry.id, entry]));

    const onEditChange = vi.fn();
    const onEditSubmit = vi.fn();
    const onEditCancel = vi.fn();

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: entries.map((entry) => entry.id),
          chatEntryMap,
          selectedSessionId: "session-1",
          editingMessageId: "u1",
          editingDraft: "Edit",
          onEditChange,
          onEditSubmit,
          onEditCancel,
        })}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Next" } });
    expect(onEditChange).toHaveBeenCalledWith("Next");

    fireEvent.click(screen.getByRole("button", { name: /Update/ }));
    expect(onEditSubmit).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onEditCancel).toHaveBeenCalled();
  });

  it("renders tool and reasoning entries with actions", () => {
    const toolMessage = buildMessage("tool", "tool", {
      id: "tool-1",
      tool_call_id: "tool-call",
      tool_name: "search",
      source_message_id: "source-1",
    });
    const toolEntry: ChatEntry = {
      id: "entry-tool",
      type: "tool-call",
      message: toolMessage,
      label: "Search",
      args: {},
      response: {},
      rawPayload: {},
      createdAt: toolMessage.created_at,
    };

    const reasoningEntry: ChatEntry = {
      id: "entry-reason",
      type: "reasoning",
      source: "assistant",
      title: "Reasoning",
      segments: [{ type: "text", content: "step" }],
      createdAt: baseTimestamp,
    };

    const chatEntryMap = new Map<string, ChatEntry>([
      [toolEntry.id, toolEntry],
      [reasoningEntry.id, reasoningEntry],
    ]);

    const onNavigateToSession = vi.fn();

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [toolEntry.id, reasoningEntry.id],
          chatEntryMap,
          selectedSessionId: "session-1",
          branchedFromSessionId: "session-2",
          branchedFromSessionTitle: "Original",
          branchedFromMessageId: "source-1",
          onNavigateToSession,
        })}
      />,
    );

    expect(screen.getByTestId(TOOL_BUBBLE_TESTID)).toBeInTheDocument();
    expect(screen.getByTestId("reasoning")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Original/ }));
    expect(onNavigateToSession).toHaveBeenCalledWith("session-2");
  });

  it("renders fallback variants and tool name headers", () => {
    const assistantMessage = buildMessage("assistant", "Hello", {
      id: "a-tool",
      tool_name: "helper",
    });
    // "custom" is an unrecognized entry type used to exercise ChatTimeline's fallback
    // rendering; it doesn't correspond to a real ChatEntry variant, hence the cast.
    const entry = {
      id: "entry-custom",
      type: "custom",
      message: assistantMessage,
      content: assistantMessage.content,
      createdAt: assistantMessage.created_at,
    } as unknown as ChatEntry;

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entry.id],
          chatEntryMap: new Map([[entry.id, entry]]),
          selectedSessionId: "session-1",
        })}
      />,
    );

    expect(screen.getByText(/ASSISTANT • helper/)).toBeInTheDocument();
  });

  it("skips branch footer when no session is selected", () => {
    const userMessage = buildMessage("user", "Hi", { id: "u7" });
    const entry: ChatEntry = {
      id: "entry-user-no-session",
      type: "user",
      message: userMessage,
      content: userMessage.content,
      createdAt: userMessage.created_at,
    };

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entry.id],
          chatEntryMap: new Map([[entry.id, entry]]),
          selectedSessionId: null,
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: /Branch chat/ })).not.toBeInTheDocument();
  });

  it("handles non-editing actions", () => {
    const userMessage = buildMessage("user", "Hi", { id: "u2" });
    const assistantMessage = buildMessage("assistant", "Hello", { id: "a2" });

    const entries: ChatEntry[] = [
      {
        id: userEntryId,
        type: "user",
        message: userMessage,
        content: userMessage.content,
        createdAt: userMessage.created_at,
      },
      {
        id: assistantEntryId,
        type: "assistant",
        message: assistantMessage,
        content: assistantMessage.content,
        createdAt: assistantMessage.created_at,
      },
    ];

    const chatEntryMap = new Map(entries.map((entry) => [entry.id, entry]));
    const onEditStart = vi.fn();
    const onRetryAssistant = vi.fn();
    const onBranchMessage = vi.fn();

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: entries.map((entry) => entry.id),
          chatEntryMap,
          selectedSessionId: "session-1",
          onEditStart,
          onRetryAssistant,
          onBranchMessage,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(onEditStart).toHaveBeenCalledWith("u2", "Hi");

    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetryAssistant).toHaveBeenCalledWith("a2");

    const branchButtons = screen.getAllByRole("button", { name: /Branch chat/ });
    fireEvent.click(branchButtons[0]);
    expect(onBranchMessage).toHaveBeenCalledWith("u2");
  });

  it("renders streaming bubbles", () => {
    const assistantMessage = buildMessage("assistant", "Hello", { id: "a3" });
    const entry: ChatEntry = {
      id: assistantEntryId,
      type: "assistant",
      message: assistantMessage,
      content: assistantMessage.content,
      createdAt: assistantMessage.created_at,
    };

    const liveToolEvents: ToolCallTrace[] = [
      { id: "tool-1", name: "search", arguments: { q: "x" }, response: {} },
    ];

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entry.id],
          chatEntryMap: new Map([[entry.id, entry]]),
          selectedSessionId: "session-1",
          showStreamingBubble: true,
          activeStreamEntryKey: "stream-1",
          liveResponse: "",
          hasLiveText: false,
          liveReasoningBlocks: [[{ type: "text", content: "step" }]],
          liveReasoningPhase: 1,
          liveToolEvents,
          liveToolOrder: ["tool-1"],
          liveToolPhaseById: { "tool-1": 0 },
          liveReasoningDisplaySegments: [{ type: "tool_call", content: "call" }],
          shouldShowStreamingReasoningBubble: true,
        })}
      />,
    );

    expect(screen.getAllByTestId(TOOL_BUBBLE_TESTID).length).toBeGreaterThan(0);
    expect(screen.getByTestId("typing")).toBeInTheDocument();
  });

  it("sorts live tool events by order and id", () => {
    const assistantMessage = buildMessage("assistant", "Hello", { id: "a4" });
    const entry: ChatEntry = {
      id: assistantEntryId,
      type: "assistant",
      message: assistantMessage,
      content: assistantMessage.content,
      createdAt: assistantMessage.created_at,
    };

    const liveToolEvents: ToolCallTrace[] = [
      { id: "tool-b", name: "Beta", arguments: {}, response: {} },
      { id: "tool-a", name: "Alpha", arguments: {}, response: {} },
    ];

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entry.id],
          chatEntryMap: new Map([[entry.id, entry]]),
          selectedSessionId: "session-1",
          showStreamingBubble: true,
          activeStreamEntryKey: "stream-2",
          liveToolEvents,
          liveToolOrder: [],
          liveToolPhaseById: { "tool-a": 0, "tool-b": 0 },
          liveReasoningPhase: 0,
        })}
      />,
    );

    const labels = screen.getAllByTestId(TOOL_BUBBLE_TESTID).map((node) => node.textContent ?? "");
    expect(labels[0]).toContain("Alpha");
    expect(labels[1]).toContain("Beta");
  });

  it("sorts live tool events by explicit order", () => {
    const assistantMessage = buildMessage("assistant", "Hello", { id: "a4b" });
    const entry: ChatEntry = {
      id: assistantEntryId,
      type: "assistant",
      message: assistantMessage,
      content: assistantMessage.content,
      createdAt: assistantMessage.created_at,
    };

    const liveToolEvents: ToolCallTrace[] = [
      { id: "tool-b", name: "Beta", arguments: {}, response: {} },
      { id: "tool-a", name: "Alpha", arguments: {}, response: {} },
    ];

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entry.id],
          chatEntryMap: new Map([[entry.id, entry]]),
          selectedSessionId: "session-1",
          showStreamingBubble: true,
          activeStreamEntryKey: "stream-2b",
          liveToolEvents,
          liveToolOrder: ["tool-b", "tool-a"],
          liveToolPhaseById: { "tool-a": 0, "tool-b": 0 },
          liveReasoningPhase: 0,
        })}
      />,
    );

    const labels = screen.getAllByTestId(TOOL_BUBBLE_TESTID).map((node) => node.textContent ?? "");
    expect(labels[0]).toContain("Beta");
    expect(labels[1]).toContain("Alpha");
  });

  it("skips empty reasoning blocks in streaming phases", () => {
    const userMessage = buildMessage("user", "Hi", { id: "u4" });
    const entry: ChatEntry = {
      id: userEntryId,
      type: "user",
      message: userMessage,
      content: userMessage.content,
      createdAt: userMessage.created_at,
    };

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entry.id],
          chatEntryMap: new Map([[entry.id, entry]]),
          selectedSessionId: "session-1",
          showStreamingBubble: false,
          activeStreamEntryKey: "stream-3",
          shouldShowStreamingReasoningBubble: true,
          liveReasoningBlocks: [[]],
          liveReasoningPhase: 1,
        })}
      />,
    );

    expect(screen.queryByTestId("reasoning")).not.toBeInTheDocument();
  });

  it("maps reasoning entries to stream keys", () => {
    const reasoningEntry: ChatEntry = {
      id: "reason-stream",
      type: "reasoning",
      source: "assistant",
      title: "Reasoning",
      segments: [{ type: "text", content: "step" }],
      messageId: "assistant-stream",
      createdAt: baseTimestamp,
    };

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [reasoningEntry.id],
          chatEntryMap: new Map([[reasoningEntry.id, reasoningEntry]]),
          streamEntryKeyMap: { "assistant-stream": "stream-key" },
          selectedSessionId: "session-1",
        })}
      />,
    );

    expect(screen.getByTestId("reasoning")).toBeInTheDocument();
  });

  it("renders tool entries with stream key overrides and message fallbacks", () => {
    const toolMessage = buildMessage("tool", "tool", {
      id: "tool-1",
      tool_call_id: "tool-call-1",
      tool_name: "search",
      source_message_id: "source-1",
    });
    const toolEntry: ChatEntry = {
      id: "entry-tool-1",
      type: "tool-call",
      message: toolMessage,
      label: "Search",
      args: {},
      response: {},
      rawPayload: {},
      createdAt: toolMessage.created_at,
    };

    const fallbackMessage = buildMessage("tool", "tool", {
      id: "tool-2",
      tool_name: "summary",
      source_message_id: "source-2",
    });
    const fallbackEntry: ChatEntry = {
      id: "entry-tool-2",
      type: "tool-call",
      message: fallbackMessage,
      messageId: "tool-msg-2",
      label: "Summary",
      args: {},
      response: {},
      rawPayload: {},
      createdAt: fallbackMessage.created_at,
    };

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [toolEntry.id, fallbackEntry.id],
          chatEntryMap: new Map([
            [toolEntry.id, toolEntry],
            [fallbackEntry.id, fallbackEntry],
          ]),
          streamEntryKeyMap: { "tool-call-1": "stream-tool-1" },
          selectedSessionId: "session-1",
        })}
      />,
    );

    expect(screen.getAllByTestId(TOOL_BUBBLE_TESTID)).toHaveLength(2);
  });

  it("uses entry ids for tool entries when no keys are present", () => {
    const toolMessage = buildMessage("tool", "tool", {
      id: "tool-3",
      tool_name: "fallback",
    });
    const toolEntry: ChatEntry = {
      id: "entry-tool-3",
      type: "tool-call",
      message: toolMessage,
      label: "Fallback",
      args: {},
      response: {},
      rawPayload: {},
      createdAt: toolMessage.created_at,
    };

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [toolEntry.id],
          chatEntryMap: new Map([[toolEntry.id, toolEntry]]),
          selectedSessionId: "session-1",
        })}
      />,
    );

    expect(screen.getByTestId(TOOL_BUBBLE_TESTID)).toBeInTheDocument();
  });

  it("renders branched tool banners without session links", () => {
    const toolMessage = buildMessage("tool", "tool", {
      id: "tool-branch",
      tool_call_id: "tool-call-branch",
      tool_name: "search",
      source_message_id: "source-branch",
    });
    const toolEntry: ChatEntry = {
      id: "entry-tool-branch",
      type: "tool-call",
      message: toolMessage,
      label: "Search",
      args: {},
      response: {},
      rawPayload: {},
      createdAt: toolMessage.created_at,
    };

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [toolEntry.id],
          chatEntryMap: new Map([[toolEntry.id, toolEntry]]),
          selectedSessionId: "session-1",
          branchedFromSessionId: null,
          branchedFromSessionTitle: ORIGINAL_CHAT_TITLE,
          branchedFromMessageId: "source-branch",
        })}
      />,
    );

    expect(screen.getByText(ORIGINAL_CHAT_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ORIGINAL_CHAT_TITLE })).not.toBeInTheDocument();
  });

  it("renders branched message banners without session links", () => {
    const userMessage = buildMessage("user", "Hi", {
      id: "u5",
      source_message_id: "source-branch-2",
    });
    const entry: ChatEntry = {
      id: "entry-user-branch",
      type: "user",
      message: userMessage,
      content: userMessage.content,
      createdAt: userMessage.created_at,
    };

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entry.id],
          chatEntryMap: new Map([[entry.id, entry]]),
          selectedSessionId: "session-1",
          branchedFromSessionId: null,
          branchedFromSessionTitle: ORIGINAL_CHAT_TITLE,
          branchedFromMessageId: "source-branch-2",
        })}
      />,
    );

    expect(screen.getByText(ORIGINAL_CHAT_TITLE)).toBeInTheDocument();
  });

  it("renders branched message banners with session links", () => {
    const userMessage = buildMessage("user", "Hi", {
      id: "u6",
      source_message_id: "source-branch-3",
    });
    const entry: ChatEntry = {
      id: "entry-user-branch-link",
      type: "user",
      message: userMessage,
      content: userMessage.content,
      createdAt: userMessage.created_at,
    };
    const onNavigateToSession = vi.fn();

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entry.id],
          chatEntryMap: new Map([[entry.id, entry]]),
          selectedSessionId: "session-1",
          branchedFromSessionId: "session-9",
          branchedFromSessionTitle: "Origin",
          branchedFromMessageId: "source-branch-3",
          onNavigateToSession,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Origin" }));
    expect(onNavigateToSession).toHaveBeenCalledWith("session-9");
  });

  it("renders usage inline and assistant reasoning subtitles", () => {
    const userMessage = buildMessage("user", "Hi", {
      id: "u3",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        reasoning_tokens: 5,
        cost: 0.01,
      },
    });
    const toolMessage = buildMessage("tool", "tool", {
      id: "tool-dup",
      tool_call_id: "tool-dup",
      tool_name: "search",
    });

    const entries: ChatEntry[] = [
      {
        id: userEntryId,
        type: "user",
        message: userMessage,
        content: userMessage.content,
        createdAt: userMessage.created_at,
      },
      {
        id: "entry-tool",
        type: "tool-call",
        message: toolMessage,
        label: "Search",
        args: {},
        response: {},
        rawPayload: {},
        createdAt: toolMessage.created_at,
      },
    ];

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: entries.map((entry) => entry.id),
          chatEntryMap: new Map(entries.map((entry) => [entry.id, entry])),
          selectedSessionId: "session-1",
          showStreamingBubble: true,
          activeStreamEntryKey: "stream-1",
          liveResponse: "Streaming",
          hasLiveText: true,
          liveReasoningDisplaySegments: [{ type: "text", content: "thinking" }],
          shouldShowStreamingReasoningBubble: true,
          liveReasoningBlocks: [[{ type: "text", content: "step" }]],
          liveReasoningPhase: 1,
          liveToolEvents: [
            { id: "tool-dup", name: "search", arguments: {}, response: {} },
            { id: "tool-new", name: "summary", arguments: {}, response: { ok: true } },
          ],
          liveToolOrder: ["tool-new"],
          liveToolPhaseById: { "tool-new": 0 },
        })}
      />,
    );

    expect(screen.getByText("30 tok")).toBeInTheDocument();
    expect(screen.getByText("10 in")).toBeInTheDocument();
    expect(screen.getByText("20 out")).toBeInTheDocument();
    expect(screen.getByText("5 reasoning")).toBeInTheDocument();
    expect(screen.getByText("$0.0100")).toBeInTheDocument();
    expect(screen.getAllByText("Reasoning Assistant reasoning").length).toBeGreaterThan(0);
    expect(screen.getByText("Streaming")).toBeInTheDocument();
  });

  it("renders streaming tool fallbacks with reasoning phases", () => {
    const toolEvents: ToolCallTrace[] = [
      {
        id: "tool-1",
        name: "",
        arguments: { query: "hi" },
        response: {},
      },
    ];
    const userMessage = buildMessage("user", "Hi", { id: "u1" });
    const entries: ChatEntry[] = [
      {
        id: userEntryId,
        type: "user",
        message: userMessage,
        content: userMessage.content,
        createdAt: userMessage.created_at,
      },
    ];

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entries[0].id],
          chatEntryMap: new Map(entries.map((entry) => [entry.id, entry])),
          selectedSessionId: "session-1",
          activeStreamEntryKey: "stream-1",
          showStreamingBubble: true,
          shouldShowStreamingReasoningBubble: true,
          liveReasoningPhase: 1,
          liveReasoningBlocks: [[{ type: "text", content: "Thinking" }]],
          liveReasoningDisplaySegments: [{ type: "text", content: "Thinking" }],
          liveToolEvents: toolEvents,
          liveToolPhaseById: {},
          hasLiveText: true,
        })}
      />,
    );

    expect(screen.getAllByTestId("reasoning")[0]).toHaveTextContent(ASSISTANT_REASONING_TEXT);
    expect(screen.getAllByTestId(TOOL_BUBBLE_TESTID)[0]).toHaveTextContent("Tool");
  });

  it("shows assistant subtitle when live reasoning types are non-string", () => {
    const entries: ChatEntry[] = [
      {
        id: "entry-1",
        type: "assistant",
        message: buildMessage("assistant", "Hello", { id: "msg-1" }),
        content: "Hello",
        createdAt: baseTimestamp,
      },
    ];

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entries[0].id],
          chatEntryMap: new Map(entries.map((entry) => [entry.id, entry])),
          selectedSessionId: "session-1",
          showStreamingBubble: true,
          shouldShowStreamingReasoningBubble: true,
          liveReasoningPhase: 0,
          liveReasoningBlocks: [[{ type: 123 as unknown as string, content: "??" }]],
          liveReasoningDisplaySegments: [{ type: 123 as unknown as string, content: "??" }],
          hasLiveText: true,
        })}
      />,
    );

    expect(screen.getByTestId("reasoning")).toHaveTextContent(ASSISTANT_REASONING_TEXT);
  });

  it("renders tool reasoning payloads and multi-phase reasoning subtitles", () => {
    const toolEvents: ToolCallTrace[] = [
      {
        id: "tool-1",
        name: "search",
        arguments: { query: "hi" },
        response: {},
        // The legacy wire format also allows a bare string; cast around the
        // narrower object-shaped type to exercise that normalization path.
        reasoning: "Looking up results" as unknown as ReasoningTraceSegment,
      },
      {
        id: "tool-2",
        name: "summarize",
        arguments: {},
      },
    ];
    const userMessage = buildMessage("user", "Hi", { id: "u1" });
    const entries: ChatEntry[] = [
      {
        id: userEntryId,
        type: "user",
        message: userMessage,
        content: userMessage.content,
        createdAt: userMessage.created_at,
      },
    ];

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entries[0].id],
          chatEntryMap: new Map(entries.map((entry) => [entry.id, entry])),
          selectedSessionId: "session-1",
          activeStreamEntryKey: "stream-1",
          showStreamingBubble: true,
          shouldShowStreamingReasoningBubble: true,
          liveReasoningPhase: 2,
          liveReasoningBlocks: [
            [{ type: "text", content: "Phase 1" }],
            [{ type: "text", content: "Phase 2" }],
          ],
          liveReasoningDisplaySegments: [{ type: "text", content: "Thinking" }],
          liveToolEvents: toolEvents,
          liveToolPhaseById: { "tool-1": 0, "tool-2": 0 },
          hasLiveText: true,
        })}
      />,
    );

    expect(screen.getAllByTestId("reasoning").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByTestId("reasoning")[0]).toHaveTextContent(ASSISTANT_REASONING_TEXT);
    expect(screen.getAllByTestId(TOOL_BUBBLE_TESTID)[0]).toHaveTextContent("search");
  });

  it("handles missing streaming reasoning blocks", () => {
    const userMessage = buildMessage("user", "Hi", { id: "u1" });
    const entries: ChatEntry[] = [
      {
        id: userEntryId,
        type: "user",
        message: userMessage,
        content: userMessage.content,
        createdAt: userMessage.created_at,
      },
    ];

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [entries[0].id],
          chatEntryMap: new Map(entries.map((entry) => [entry.id, entry])),
          selectedSessionId: "session-1",
          activeStreamEntryKey: "stream-1",
          showStreamingBubble: true,
          shouldShowStreamingReasoningBubble: true,
          liveReasoningPhase: 1,
          liveReasoningBlocks: [],
          liveReasoningDisplaySegments: [{ type: "text", content: "Thinking" }],
          hasLiveText: true,
        })}
      />,
    );

    expect(screen.getByTestId("reasoning")).toBeInTheDocument();
  });

  it("suppresses streaming reasoning when final reasoning exists", () => {
    const reasoningEntry: ChatEntry = {
      id: "reason-final",
      type: "reasoning",
      source: "assistant",
      title: "Reasoning",
      segments: [{ type: "text", content: "final" }],
      messageId: "assistant-final",
      createdAt: baseTimestamp,
    };

    render(
      <ChatTimeline
        {...baseProps({
          chatEntryOrder: [reasoningEntry.id],
          chatEntryMap: new Map([[reasoningEntry.id, reasoningEntry]]),
          selectedSessionId: "session-1",
          showStreamingBubble: true,
          activeStreamEntryKey: "stream-1",
          finalStreamAssistantId: "assistant-final",
          shouldShowStreamingReasoningBubble: true,
          liveReasoningDisplaySegments: [{ type: "text", content: "live" }],
        })}
      />,
    );

    expect(screen.getAllByTestId("reasoning")).toHaveLength(1);
  });
});
