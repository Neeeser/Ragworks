import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HistoryPanel } from "@/components/chat-studio/HistoryPanel";

import type { ChatSession, Collection } from "@/lib/types";

describe("HistoryPanel", () => {
  const baseTimestamp = "2024-01-01T00:00:00.000Z";
  const collections: Collection[] = [
    {
      id: "col-1",
      user_id: "user-1",
      name: "Alpha",
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    },
    {
      id: "col-2",
      user_id: "user-1",
      name: "Beta",
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    },
  ];

  const sessions: ChatSession[] = [
    {
      id: "session-1",
      user_id: "user-1",
      title: "Chat 9:15 PM",
      chat_model: "model-a",
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
      tool_collection_ids: ["col-1"],
    },
    {
      id: "session-2",
      user_id: "user-1",
      title: "Project notes",
      chat_model: "model-b",
      created_at: "invalid-date",
      updated_at: "2024-01-02T00:00:00.000Z",
      tool_collection_ids: [],
    },
    {
      id: "session-3",
      user_id: "user-1",
      title: "Chat 2:05 AM",
      chat_model: "model-c",
      created_at: "invalid-date",
      updated_at: baseTimestamp,
      tool_collection_ids: [],
    },
  ];

  it("handles filtering and selection actions", () => {
    const onSelect = vi.fn();
    const onNewChat = vi.fn();
    const onFilterChange = vi.fn();
    const onDelete = vi.fn();
    const onClose = vi.fn();

    render(
      <HistoryPanel
        collections={collections}
        sessions={sessions}
        selectedSessionId={"session-1"}
        onSelect={onSelect}
        onNewChat={onNewChat}
        filterCollectionIds={["col-1"]}
        filterIncludeUnassigned
        onFilterChange={onFilterChange}
        onDelete={onDelete}
        deletingSessionId={null}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByText("Filters active")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "No collections" }));
    expect(onFilterChange).toHaveBeenCalledWith(["col-1"], false);

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(onFilterChange).toHaveBeenCalledWith([], true);

    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onFilterChange).toHaveBeenCalledWith(["col-1", "col-2"], true);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onFilterChange).toHaveBeenCalledWith([], false);

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(onNewChat).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Delete Chat 9:15 PM/ }));
    expect(onDelete).toHaveBeenCalledWith("session-1");

    fireEvent.click(screen.getByRole("button", { name: /Close history/ }));
    expect(onClose).toHaveBeenCalled();

    const projectButtons = screen.getAllByRole("button", { name: /Project notes/ });
    fireEvent.click(projectButtons[0]);
    expect(onSelect).toHaveBeenCalledWith("session-2");
  }, 10000);

  it("renders empty state and disables delete when busy", () => {
    render(
      <HistoryPanel
        collections={[]}
        sessions={[]}
        selectedSessionId={null}
        onSelect={() => undefined}
        onNewChat={() => undefined}
        filterCollectionIds={[]}
        filterIncludeUnassigned={false}
        onFilterChange={() => undefined}
        onDelete={() => undefined}
        deletingSessionId={"session-1"}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText(/No chats yet/)).toBeInTheDocument();
  });

  it("shows empty collection filters", () => {
    render(
      <HistoryPanel
        collections={[]}
        sessions={sessions}
        selectedSessionId={null}
        onSelect={() => undefined}
        onNewChat={() => undefined}
        filterCollectionIds={[]}
        filterIncludeUnassigned={false}
        onFilterChange={() => undefined}
        onDelete={() => undefined}
        deletingSessionId={null}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByText("No collections available.")).toBeInTheDocument();
  });

  it("shows unknown filter chips and unassigned sessions", () => {
    const sessionsWithNull: ChatSession[] = [
      {
        id: "session-null",
        user_id: "user-1",
        title: "Chat 10:10 AM",
        chat_model: "model-x",
        created_at: baseTimestamp,
        updated_at: baseTimestamp,
        tool_collection_ids: null,
      },
    ];

    render(
      <HistoryPanel
        collections={collections}
        sessions={sessionsWithNull}
        selectedSessionId={null}
        onSelect={() => undefined}
        onNewChat={() => undefined}
        filterCollectionIds={["missing-col"]}
        filterIncludeUnassigned={false}
        onFilterChange={() => undefined}
        onDelete={() => undefined}
        deletingSessionId={null}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getAllByText("No collections").length).toBeGreaterThan(0);
  });
});
