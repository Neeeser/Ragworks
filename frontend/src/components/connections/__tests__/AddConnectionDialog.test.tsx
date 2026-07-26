import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AddConnectionDialog } from "@/components/connections/AddConnectionDialog";
import { validateConnectionConfig } from "@/lib/api";
import { makeConnection, makeProviderType } from "@/test/fixtures/providers";

vi.mock("@/lib/api", async () => {
  const { mockApi } = await import("@/test/mocks");
  return mockApi();
});

const ollamaType = makeProviderType({
  provider_type: "ollama",
  label: "Ollama",
  docs_url: "https://ollama.com/download",
  kinds: ["embedding", "chat"],
  max_connections_per_user: null,
  recommended: false,
  config_fields: [
    { name: "base_url", label: "Server URL", kind: "url", required: true, placeholder: null },
  ],
});

const openRouterType = makeProviderType({ provider_type: "openrouter", label: "OpenRouter" });

const pineconeType = makeProviderType({
  provider_type: "pinecone",
  label: "Pinecone",
  kinds: ["vector_store"],
  max_connections_per_user: 1,
  recommended: false,
});

function renderDialog(types = [ollamaType, openRouterType]) {
  return render(
    <AddConnectionDialog
      open
      onClose={() => {}}
      authToken="token"
      providerTypes={types}
      existingConnections={[]}
      onCreated={() => {}}
    />,
  );
}

function renderPicker(
  providerTypes = [pineconeType, ollamaType, openRouterType],
  existingConnections = [makeConnection({ id: "conn-pinecone-1", provider_type: "pinecone" })],
) {
  return render(
    <AddConnectionDialog
      open
      onClose={vi.fn()}
      authToken="token"
      providerTypes={providerTypes}
      existingConnections={existingConnections}
      onCreated={vi.fn()}
    />,
  );
}

const card = (name: RegExp) => screen.getByRole("button", { name });

describe("AddConnectionDialog", () => {
  it("shows the probe result outside the scrolling form body", async () => {
    const user = userEvent.setup();
    vi.mocked(validateConnectionConfig).mockResolvedValueOnce({
      valid: true,
      message: "Connected (ollama 0.5.4).",
    });
    renderDialog();

    await user.click(screen.getByRole("button", { name: /Ollama/ }));
    await user.type(screen.getByLabelText("Server URL"), "http://localhost:11434");
    await user.click(screen.getByRole("button", { name: "Test" }));

    const status = await screen.findByText("Connected (ollama 0.5.4).");
    // Inside the scrolling body the result rendered under a long form, below
    // the fold — invisible unless the user scrolled the dialog.
    expect(status.closest(".overflow-y-auto")).toBeNull();
    await waitFor(() => expect(status).toBeVisible());
  });

  it("uses the right article for a vowel-initial provider name", async () => {
    const user = userEvent.setup();
    renderDialog([openRouterType]);

    await user.click(screen.getByRole("button", { name: /OpenRouter/ }));
    expect(screen.getByRole("link", { name: "Get an OpenRouter API key" })).toBeInTheDocument();
  });
});

describe("AddConnectionDialog provider picker", () => {
  it("keeps a provider at its connection limit on the grid, disabled and marked connected", () => {
    renderPicker();
    const pinecone = card(/pinecone/i);
    expect(pinecone).toBeDisabled();
    expect(within(pinecone).getByText("Connected")).toBeInTheDocument();
    // The card must still say what the provider is and what it can do.
    expect(within(pinecone).getByText("Pinecone")).toBeInTheDocument();
    expect(within(pinecone).getByText("Vector DB")).toBeInTheDocument();
  });

  it("does not open the connect form when an at-limit provider card is clicked", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(card(/pinecone/i));
    expect(screen.queryByText("Connect Pinecone")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add a provider" })).toBeInTheDocument();
  });

  it("keeps an under-limit provider clickable and shows how many are connected", async () => {
    const user = userEvent.setup();
    renderPicker(
      [ollamaType],
      [
        makeConnection({ id: "conn-ollama-1", provider_type: "ollama" }),
        makeConnection({ id: "conn-ollama-2", provider_type: "ollama" }),
      ],
    );
    const ollama = card(/ollama/i);
    expect(ollama).toBeEnabled();
    expect(within(ollama).getByText("2 connected")).toBeInTheDocument();
    await user.click(ollama);
    expect(screen.getByRole("heading", { name: "Connect Ollama" })).toBeInTheDocument();
  });

  it("renders an unconnected provider with its recommendation and no connected state", () => {
    renderPicker([openRouterType], []);
    const openrouter = card(/openrouter/i);
    expect(openrouter).toBeEnabled();
    expect(within(openrouter).getByText("Recommended")).toBeInTheDocument();
    expect(within(openrouter).queryByText(/connected/i)).not.toBeInTheDocument();
  });

  it("hides builtin provider types from the grid", () => {
    renderPicker([
      makeProviderType({ provider_type: "pgvector", label: "pgvector", builtin: true }),
    ]);
    expect(screen.queryByRole("button", { name: /pgvector/i })).not.toBeInTheDocument();
    expect(screen.getByText("Every available provider is already connected.")).toBeInTheDocument();
  });
});
