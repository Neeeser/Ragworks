import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AddConnectionDialog } from "@/components/connections/AddConnectionDialog";
import { probeCustomServer, validateConnectionConfig } from "@/lib/api";
import {
  makeConnection,
  makeProviderConfigField,
  makeProviderType,
} from "@/test/fixtures/providers";

const SERVER_URL_LABEL = "Server URL";
const SERVES_CHAT_LABEL = "Serves chat";
const SERVES_EMBEDDINGS_LABEL = "Serves embeddings";
const SERVES_RERANKING_LABEL = "Serves reranking";
const LOCAL_SERVER_URL = "http://localhost:8000";

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
    makeProviderConfigField({ name: "base_url", label: SERVER_URL_LABEL, kind: "url" }),
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
    await user.type(screen.getByLabelText(SERVER_URL_LABEL), "http://localhost:11434");
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
    expect(screen.getByText("No provider types are available.")).toBeInTheDocument();
  });
});

const customType = makeProviderType({
  provider_type: "custom",
  label: "Custom server",
  kinds: ["chat", "embedding", "reranking"],
  recommended: false,
  config_fields: [
    makeProviderConfigField({ name: "base_url", label: SERVER_URL_LABEL, kind: "url" }),
    makeProviderConfigField({
      name: "api_key",
      label: "API key (optional)",
      kind: "secret",
      required: false,
    }),
    makeProviderConfigField({
      name: "serves_chat",
      label: SERVES_CHAT_LABEL,
      kind: "boolean",
      required: false,
      default: true,
    }),
    makeProviderConfigField({
      name: "serves_embeddings",
      label: SERVES_EMBEDDINGS_LABEL,
      kind: "boolean",
      required: false,
      default: true,
    }),
    makeProviderConfigField({
      name: "serves_reranking",
      label: SERVES_RERANKING_LABEL,
      kind: "boolean",
      required: false,
      default: false,
    }),
    makeProviderConfigField({
      name: "chat_dialect",
      label: "Chat API",
      kind: "select",
      required: false,
      advanced: true,
      default: "chat_completions",
      options: [
        { value: "chat_completions", label: "Chat Completions", description: null },
        { value: "responses", label: "Responses", description: null },
      ],
    }),
  ],
});

async function openCustomForm() {
  const user = userEvent.setup();
  render(
    <AddConnectionDialog
      open
      onClose={vi.fn()}
      authToken="token"
      providerTypes={[customType]}
      existingConnections={[]}
      onCreated={vi.fn()}
    />,
  );
  await user.click(card(/Custom server/));
  return user;
}

describe("AddConnectionDialog custom-server detection", () => {
  it("writes the probed capabilities into the form", async () => {
    const user = await openCustomForm();
    vi.mocked(probeCustomServer).mockResolvedValueOnce({
      reachable: true,
      serves_chat: true,
      serves_embeddings: false,
      serves_reranking: true,
      serves_responses: false,
      unauthorized: false,
      model_ids: ["a", "b"],
      message: null,
    });

    await user.type(screen.getByLabelText(SERVER_URL_LABEL), LOCAL_SERVER_URL);
    await user.click(screen.getByRole("button", { name: "Detect" }));

    await waitFor(() => {
      expect(screen.getByLabelText(SERVES_RERANKING_LABEL)).toBeChecked();
    });
    expect(screen.getByLabelText(SERVES_CHAT_LABEL)).toBeChecked();
    expect(screen.getByLabelText(SERVES_EMBEDDINGS_LABEL)).not.toBeChecked();
  });

  it("reports a rejected key as an error and leaves the toggles alone", async () => {
    const user = await openCustomForm();
    vi.mocked(probeCustomServer).mockResolvedValueOnce({
      reachable: true,
      serves_chat: false,
      serves_embeddings: false,
      serves_reranking: false,
      serves_responses: false,
      unauthorized: true,
      model_ids: [],
      message: "The server rejected the API key.",
    });

    await user.type(screen.getByLabelText(SERVER_URL_LABEL), LOCAL_SERVER_URL);
    await user.click(screen.getByRole("button", { name: "Detect" }));

    // Every surface answers 401 when the key is wrong, so the probe learned
    // nothing — clearing the toggles would blame the wrong field.
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("rejected the API key");
    });
    expect(screen.getByRole("status")).toHaveClass("text-data-neg");
    expect(screen.getByLabelText(SERVES_CHAT_LABEL)).toBeChecked();
    expect(screen.getByLabelText(SERVES_EMBEDDINGS_LABEL)).toBeChecked();
  });

  it("keeps advanced fields behind a disclosure", async () => {
    const user = await openCustomForm();

    expect(screen.queryByLabelText("Chat API")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Advanced" }));

    expect(screen.getByText("Chat Completions")).toBeInTheDocument();
  });
});
