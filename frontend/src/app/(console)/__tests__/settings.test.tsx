import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "@/app/(console)/settings/page";
import * as apiModule from "@/lib/api";

const OLLAMA_URL = "http://192.168.1.225:11434";

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const TOKEN = "test-token";

describe("SettingsPage (provider connections)", () => {
  beforeEach(async () => {
    const { resetMockAuth } = await import("@/test/mocks");
    resetMockAuth();
  });

  it("lists configured connections with capability badges and built-ins", async () => {
    render(<SettingsPage />);

    expect(await screen.findByText("OpenRouter")).toBeInTheDocument();
    expect(screen.getAllByText("Embeddings").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chat").length).toBeGreaterThan(0);
    // Built-in pgvector renders as a non-removable entry.
    expect(await screen.findByText("pgvector (PostgreSQL)")).toBeInTheDocument();
  });

  it("adds an Ollama connection through the data-driven form", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: /add provider/i }));
    await user.click(await screen.findByRole("button", { name: /ollama/i }));

    // The form renders from the provider type's config_fields catalog.
    const urlInput = await screen.findByLabelText("Server URL");
    await user.type(urlInput, OLLAMA_URL);
    expect(screen.getByLabelText(/API key \(optional/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add connection/i }));

    await waitFor(() => {
      expect(api.createConnection).toHaveBeenCalledWith(
        TOKEN,
        expect.objectContaining({
          provider_type: "ollama",
          config: { base_url: OLLAMA_URL },
        }),
      );
    });
  });

  it("surfaces a failed pre-save probe without creating the connection", async () => {
    api.validateConnectionConfig.mockResolvedValueOnce({
      valid: false,
      message: "The Ollama server is unreachable.",
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: /add provider/i }));
    await user.click(await screen.findByRole("button", { name: /ollama/i }));
    await user.type(await screen.findByLabelText("Server URL"), "http://10.0.0.9:11434");
    await user.click(screen.getByRole("button", { name: /^test$/i }));

    expect(await screen.findByText("The Ollama server is unreachable.")).toBeInTheDocument();
    expect(api.createConnection).not.toHaveBeenCalled();
  });

  it("removes a connection after confirmation", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: /remove openrouter/i }));
    await user.click(await screen.findByRole("button", { name: /^remove$/i }));

    await waitFor(() => {
      expect(api.deleteConnection).toHaveBeenCalledWith(TOKEN, "conn-openrouter-1");
    });
  });

  it("validates a saved connection and shows the outcome", async () => {
    api.validateConnection.mockResolvedValueOnce({ valid: true, message: "Connected." });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: /validate openrouter/i }));

    expect(await screen.findByText("Connected.")).toBeInTheDocument();
    expect(api.validateConnection).toHaveBeenCalledWith(TOKEN, "conn-openrouter-1");
  });
});
