import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AddConnectionDialog } from "@/components/connections/AddConnectionDialog";
import { validateConnectionConfig } from "@/lib/api";
import { makeProviderType } from "@/test/fixtures/providers";

vi.mock("@/lib/api", async () => {
  const { mockApi } = await import("@/test/mocks");
  return mockApi();
});

const ollamaType = makeProviderType({
  provider_type: "ollama",
  label: "Ollama",
  docs_url: "https://ollama.com/download",
  config_fields: [
    { name: "base_url", label: "Server URL", kind: "url", required: true, placeholder: null },
  ],
});

const openRouterType = makeProviderType({ provider_type: "openrouter", label: "OpenRouter" });

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
