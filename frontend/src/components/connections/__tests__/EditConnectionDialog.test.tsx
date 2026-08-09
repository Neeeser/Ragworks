import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EditConnectionDialog } from "@/components/connections/EditConnectionDialog";
import { updateConnection, validateConnection } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import {
  makeConnection,
  makeProviderConfigField,
  makeProviderType,
} from "@/test/fixtures/providers";

const SERVER_URL_LABEL = "Server URL";
const API_KEY_LABEL = "API key";
const STORED_URL = "http://192.168.1.225:11434";
const TEST_BUTTON = "Test";
const SAVE_BUTTON = "Save changes";
const SAVE_ANYWAY_BUTTON = "Save anyway";
const REFUSED = "Connection refused.";
const CONNECTED = "Connected.";

vi.mock("@/lib/api", async () => {
  const { mockApi } = await import("@/test/mocks");
  return mockApi();
});

const ollamaType = makeProviderType({
  provider_type: "ollama",
  label: "Ollama",
  config_fields: [
    makeProviderConfigField({ name: "base_url", label: SERVER_URL_LABEL, kind: "url" }),
    makeProviderConfigField({
      name: "api_key",
      label: API_KEY_LABEL,
      kind: "secret",
      required: false,
    }),
  ],
});

const ollamaConnection = makeConnection({
  id: "conn-ollama-1",
  provider_type: "ollama",
  label: "Ollama",
  config: { base_url: STORED_URL },
  secrets_configured: { api_key: true },
});

function renderDialog(connection = ollamaConnection) {
  return render(
    <EditConnectionDialog
      connection={connection}
      providerType={ollamaType}
      authToken="token"
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
}

const unreachable = () =>
  new ApiError(400, REFUSED, {
    code: "connection",
    message: REFUSED,
    retryable: true,
  });

describe("EditConnectionDialog testing", () => {
  it("probes only the fields the save would send", async () => {
    const user = userEvent.setup();
    vi.mocked(validateConnection).mockResolvedValueOnce({ valid: true, message: CONNECTED });
    renderDialog();

    await user.clear(screen.getByLabelText(SERVER_URL_LABEL));
    await user.type(screen.getByLabelText(SERVER_URL_LABEL), "http://10.0.0.4:11434");
    await user.click(screen.getByRole("button", { name: TEST_BUTTON }));

    expect(await screen.findByText(CONNECTED)).toBeVisible();
    // The stored API key was never re-typed, so it is omitted and the backend
    // falls back to it — sending a blank would probe unauthenticated and
    // report a rejection the user cannot see the cause of.
    expect(vi.mocked(validateConnection)).toHaveBeenCalledWith("token", "conn-ollama-1", {
      base_url: "http://10.0.0.4:11434",
    });
  });

  it("reports an unreachable server without blocking the dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(validateConnection).mockResolvedValueOnce({
      valid: false,
      message: REFUSED,
    });
    renderDialog();

    await user.click(screen.getByRole("button", { name: TEST_BUTTON }));

    expect(await screen.findByText(REFUSED)).toBeVisible();
    expect(screen.getByRole("button", { name: SAVE_BUTTON })).toBeEnabled();
  });
});

describe("EditConnectionDialog save-anyway", () => {
  it("offers to save anyway when the provider could not be reached", async () => {
    const user = userEvent.setup();
    vi.mocked(updateConnection).mockRejectedValueOnce(unreachable());
    renderDialog();

    await user.type(screen.getByLabelText(SERVER_URL_LABEL), "9");
    await user.click(screen.getByRole("button", { name: SAVE_BUTTON }));

    expect(await screen.findByText(REFUSED)).toBeVisible();
    expect(screen.getByRole("button", { name: SAVE_ANYWAY_BUTTON })).toBeVisible();
  });

  it("skips the probe on the confirming click, and only then", async () => {
    const user = userEvent.setup();
    vi.mocked(updateConnection).mockRejectedValueOnce(unreachable());
    vi.mocked(updateConnection).mockResolvedValueOnce(ollamaConnection);
    renderDialog();

    await user.type(screen.getByLabelText(SERVER_URL_LABEL), "9");
    await user.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await user.click(await screen.findByRole("button", { name: SAVE_ANYWAY_BUTTON }));

    await waitFor(() => expect(vi.mocked(updateConnection)).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(updateConnection).mock.calls;
    expect(first[2].skip_validation).toBeUndefined();
    expect(second[2].skip_validation).toBe(true);
  });

  it("rechecks a config the user corrected after the failure", async () => {
    const user = userEvent.setup();
    vi.mocked(updateConnection).mockRejectedValueOnce(unreachable());
    renderDialog();

    await user.type(screen.getByLabelText(SERVER_URL_LABEL), "9");
    await user.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await screen.findByRole("button", { name: SAVE_ANYWAY_BUTTON });

    await user.type(screen.getByLabelText(SERVER_URL_LABEL), "0");

    expect(screen.getByRole("button", { name: SAVE_BUTTON })).toBeVisible();
  });

  it("rechecks after a fresh test rather than carrying the old refusal", async () => {
    const user = userEvent.setup();
    vi.mocked(updateConnection).mockRejectedValueOnce(unreachable());
    vi.mocked(validateConnection).mockResolvedValueOnce({ valid: true, message: CONNECTED });
    renderDialog();

    await user.type(screen.getByLabelText(SERVER_URL_LABEL), "9");
    await user.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await screen.findByRole("button", { name: SAVE_ANYWAY_BUTTON });
    await user.click(screen.getByRole("button", { name: TEST_BUTTON }));

    expect(await screen.findByText(CONNECTED)).toBeVisible();
    expect(screen.getByRole("button", { name: SAVE_BUTTON })).toBeVisible();
  });
});
