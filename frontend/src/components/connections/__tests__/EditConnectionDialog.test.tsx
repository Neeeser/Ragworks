import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EditConnectionDialog } from "@/components/connections/EditConnectionDialog";
import { updateConnection } from "@/lib/api";
import { makeConnection, makeProviderType } from "@/test/fixtures/providers";

vi.mock("@/lib/api", async () => {
  const { mockApi } = await import("@/test/mocks");
  return mockApi();
});

const SERVER_URL_LABEL = "Server URL";
const HOMELAB_URL = "http://192.168.1.225:11434";
const SAVE_BUTTON = /save changes/i;
const HOMELAB_LABEL = "Homelab Ollama";

const ollamaType = makeProviderType({
  provider_type: "ollama",
  label: "Ollama",
  config_fields: [
    { name: "base_url", label: SERVER_URL_LABEL, kind: "url", required: true, placeholder: null },
    { name: "api_key", label: "API key", kind: "secret", required: false, placeholder: null },
  ],
});

const ollamaConnection = makeConnection({
  id: "conn-ollama-1",
  provider_type: "ollama",
  label: HOMELAB_LABEL,
  config: { base_url: HOMELAB_URL },
  secrets_configured: { api_key: false },
});

describe("EditConnectionDialog", () => {
  it("prefills the label and non-secret config from the connection", () => {
    render(
      <EditConnectionDialog
        connection={ollamaConnection}
        providerType={ollamaType}
        authToken="token"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Label")).toHaveValue(HOMELAB_LABEL);
    expect(screen.getByLabelText(SERVER_URL_LABEL)).toHaveValue(HOMELAB_URL);
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });

  it("saves a changed base URL and reports the update", async () => {
    const user = userEvent.setup();
    const onUpdated = vi.fn();
    render(
      <EditConnectionDialog
        connection={ollamaConnection}
        providerType={ollamaType}
        authToken="token"
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />,
    );
    const url = screen.getByLabelText(SERVER_URL_LABEL);
    await user.clear(url);
    await user.type(url, "http://10.0.0.9:11434");
    await user.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(updateConnection).toHaveBeenCalledWith("token", "conn-ollama-1", {
      label: HOMELAB_LABEL,
      config: { base_url: "http://10.0.0.9:11434" },
    });
  });

  it("keeps a configured secret when the field is left blank", async () => {
    const user = userEvent.setup();
    const withSecret = makeConnection({
      id: "conn-or-1",
      provider_type: "openrouter",
      label: "OpenRouter",
      config: {},
      secrets_configured: { api_key: true },
    });
    render(
      <EditConnectionDialog
        connection={withSecret}
        providerType={makeProviderType()}
        authToken="token"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/configured — leave blank to keep the current value/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await waitFor(() => expect(updateConnection).toHaveBeenCalled());
    // Only the label goes over the wire — no config key, so the secret is untouched.
    expect(updateConnection).toHaveBeenCalledWith("token", "conn-or-1", {
      label: "OpenRouter",
    });
  });

  it("sends a re-entered secret as a rotation", async () => {
    const user = userEvent.setup();
    const withSecret = makeConnection({
      id: "conn-or-2",
      provider_type: "openrouter",
      secrets_configured: { api_key: true },
    });
    render(
      <EditConnectionDialog
        connection={withSecret}
        providerType={makeProviderType()}
        authToken="token"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("API key"), "sk-or-new");
    await user.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await waitFor(() =>
      expect(updateConnection).toHaveBeenCalledWith("token", "conn-or-2", {
        label: "OpenRouter",
        config: { api_key: "sk-or-new" },
      }),
    );
  });
});
