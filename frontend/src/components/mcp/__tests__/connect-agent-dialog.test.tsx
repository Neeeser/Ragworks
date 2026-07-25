"use client";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConnectAgentDialog } from "@/components/mcp/ConnectAgentDialog";
import { makeApiKey, makeCollection } from "@/test/fixtures";

const ENDPOINT = "https://rag.example.com/api/mcp/collections/col-1";
const SECRET = "rw_secret-value";
const CREATE_KEY = "Create key";

function renderDialog(onCreate = vi.fn()) {
  const props = {
    open: true,
    collection: makeCollection({ name: "Field Notes" }),
    endpoint: ENDPOINT,
    busy: false,
    error: null,
    onCreate,
    onClose: vi.fn(),
  };
  render(<ConnectAgentDialog {...props} />);
  return props;
}

describe("ConnectAgentDialog", () => {
  it("issues a key for this collection with the chosen capabilities", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => ({ key: makeApiKey(), secret: SECRET }));
    renderDialog(onCreate);

    await user.click(screen.getByRole("checkbox", { name: /Read files/ }));
    await user.click(screen.getByRole("button", { name: CREATE_KEY }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: "Field Notes agent",
        capabilities: ["tools:invoke", "files:read"],
        all_collections: false,
        collection_ids: ["col-1"],
      }),
    );
  });

  it("issues an all-collections key when that scope is chosen", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => ({ key: makeApiKey(), secret: SECRET }));
    renderDialog(onCreate);

    await user.click(screen.getByRole("radio", { name: /Every collection/ }));
    await user.click(screen.getByRole("button", { name: CREATE_KEY }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ all_collections: true, collection_ids: [] }),
      ),
    );
  });

  it("shows the secret and a ready-to-run command once the key exists", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => ({ key: makeApiKey(), secret: SECRET }));
    renderDialog(onCreate);

    await user.click(screen.getByRole("button", { name: CREATE_KEY }));

    // The secret appears both on its own and inside the command snippet.
    await waitFor(() => expect(screen.getAllByText(new RegExp(SECRET)).length).toBeGreaterThan(0));
    expect(screen.getByText(/claude mcp add ragworks-field-notes/)).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(ENDPOINT)).length).toBeGreaterThan(0);
    // The one-time nature of the secret is stated, not implied.
    expect(screen.getByText(/shown once/)).toBeInTheDocument();
  });

  it("gives each harness its own configuration shape", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => ({ key: makeApiKey(), secret: SECRET }));
    renderDialog(onCreate);

    await user.click(screen.getByRole("button", { name: CREATE_KEY }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Cursor" })).toBeInTheDocument());

    await user.click(screen.getByRole("tab", { name: "Cursor" }));
    expect(screen.getByText(/"mcpServers"/)).toBeInTheDocument();

    // VS Code keys servers differently; the generic block silently does nothing
    // there, so the tab must not just relabel the same snippet.
    await user.click(screen.getByRole("tab", { name: "VS Code" }));
    expect(screen.getByText(/"servers"/)).toBeInTheDocument();
    expect(screen.queryByText(/"mcpServers"/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "OpenAI" }));
    expect(screen.getByText(/"server_url"/)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.getByText(/\[mcp_servers\.ragworks-field-notes\]/)).toBeInTheDocument();

    // Nothing is Ragworks-specific beyond the URL and the header, and an
    // unlisted client needs to see exactly that.
    await user.click(screen.getByRole("tab", { name: "Any client" }));
    expect(screen.getByText(/curl -X POST/)).toBeInTheDocument();
  });

  it("cannot create a key with no capabilities", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderDialog(onCreate);

    await user.click(screen.getByRole("checkbox", { name: /Run tools/ }));

    expect(screen.getByRole("button", { name: CREATE_KEY })).toBeDisabled();
  });

  it("keeps the form open and shows the error when creation fails", async () => {
    const user = userEvent.setup();
    const props = {
      open: true,
      collection: makeCollection({ name: "Field Notes" }),
      endpoint: ENDPOINT,
      busy: false,
      error: "Unable to create the key.",
      onCreate: vi.fn(async () => null),
      onClose: vi.fn(),
    };
    render(<ConnectAgentDialog {...props} />);

    await user.click(screen.getByRole("button", { name: CREATE_KEY }));

    expect(screen.getByText("Unable to create the key.")).toBeInTheDocument();
    expect(screen.queryByText(/rw_secret/)).not.toBeInTheDocument();
  });
});
