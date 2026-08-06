import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolTraceEntry } from "@/components/chat-studio/timeline/ToolTraceEntry";
import { makeChatMessage } from "@/test/fixtures";

import type { ChatToolEntry } from "@/components/chat-studio/lib/chat-types";

vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "token" }),
);

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

describe("ToolTraceEntry", () => {
  it("renders an image match from the persisted tool payload", async () => {
    // A reloaded transcript rebuilds tool bubbles from the stored payload,
    // whose collection_id is what scopes the asset fetch — the streaming
    // path passing it while this path dropped it is the regression.
    global.URL.createObjectURL = vi.fn(() => "blob:persisted-asset");
    global.URL.revokeObjectURL = vi.fn();

    const response = {
      chunks: [
        {
          chunk_id: "doc:img:0",
          text: "[image: chart.png]",
          score: 0.8,
          metadata: {
            "ragworks.image_asset": {
              media_type: "image/png",
              path: "collections/c1/derived/d1/chart.png",
              width: 480,
              height: 320,
            },
          },
        },
      ],
    };
    const entry: ChatToolEntry = {
      id: "m1:tool",
      type: "tool-call",
      messageId: "m1",
      createdAt: new Date().toISOString(),
      message: makeChatMessage({ role: "tool", tool_call_id: "call-1" }),
      label: "Query",
      args: { query: "sunspots" },
      response,
      rawPayload: { collection_id: "c1", collection_name: "Papers", response },
    };

    render(
      <ToolTraceEntry
        entry={entry}
        streamEntryKeyMap={{}}
        branchedFromMessageId={null}
        branchedFromSessionId={null}
        branchedFromSessionTitle={null}
        onNavigateToSession={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Summary/ }));
    fireEvent.click(screen.getByRole("button", { name: /Retrieved chunks/ }));

    const image = await screen.findByRole("img", { name: /doc:img:0/ });
    expect(image).toHaveAttribute("src", "blob:persisted-asset");
  });
});
