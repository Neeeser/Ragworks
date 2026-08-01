"use client";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { McpAccessCard } from "@/components/mcp/McpAccessCard";
import * as apiModule from "@/lib/api";
import { makeApiKey, makeCollection, makePublicConfig } from "@/test/fixtures";
import { resetMockAppConfig, setMockAppConfig } from "@/test/mocks";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

const api = vi.mocked(apiModule);
const SCOPED_AGENT = "Scoped agent";

function renderCard() {
  return render(<McpAccessCard collection={makeCollection()} token="token" />);
}

describe("McpAccessCard", () => {
  beforeEach(resetMockAppConfig);

  it("shows the collection's endpoint so it can be pasted into a harness", async () => {
    renderCard();

    // Which origin serves the API is mode-dependent and pinned in
    // connection.test.ts; the card's own job is rendering the endpoint path.
    await waitFor(() => {
      expect(screen.getByText(/\/api\/mcp\/collections\/col-1$/)).toBeInTheDocument();
    });
  });

  it("renders nothing when the deployment disables MCP access", () => {
    setMockAppConfig({
      config: makePublicConfig({
        features: { collection_insights: true, chat_branching: true, mcp_access: false },
      }),
    });

    const { container } = renderCard();

    expect(container).toBeEmptyDOMElement();
  });

  it("lists every unrevoked key reaching this collection, and no others", async () => {
    api.listApiKeys.mockResolvedValue({
      keys: [
        makeApiKey({ id: "k1", name: SCOPED_AGENT, collection_ids: ["col-1"] }),
        // Issued elsewhere but scoped to include this collection: it can reach
        // the endpoint, so omitting it would misrepresent who has access.
        makeApiKey({ id: "k2", name: "Shared agent", collection_ids: ["col-2", "col-1"] }),
        makeApiKey({ id: "k3", name: "Elsewhere agent", collection_ids: ["col-2"] }),
        makeApiKey({ id: "k4", name: "Retired agent", revoked_at: "2026-07-02T00:00:00Z" }),
      ],
    });

    renderCard();

    await waitFor(() => expect(screen.getByText(SCOPED_AGENT)).toBeInTheDocument());
    expect(screen.getByText("Shared agent")).toBeInTheDocument();
    expect(screen.queryByText("Elsewhere agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Retired agent")).not.toBeInTheDocument();
  });

  it("revokes a key only after the confirmation is accepted", async () => {
    const user = userEvent.setup();
    api.listApiKeys.mockResolvedValue({ keys: [makeApiKey({ id: "k1", name: SCOPED_AGENT })] });

    renderCard();
    await waitFor(() => expect(screen.getByText(SCOPED_AGENT)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: `Revoke ${SCOPED_AGENT}` }));

    expect(api.revokeApiKey).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(api.revokeApiKey).toHaveBeenCalledWith("token", "k1"));
  });

  it("surfaces a listing failure instead of showing an empty state", async () => {
    api.listApiKeys.mockRejectedValue(new Error("network down"));

    renderCard();

    await waitFor(() => expect(screen.getByText("network down")).toBeInTheDocument());
  });
});
