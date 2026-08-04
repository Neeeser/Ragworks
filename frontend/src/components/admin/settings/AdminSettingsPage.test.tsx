import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdminSettingsPage } from "@/components/admin/settings/AdminSettingsPage";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { formatApiErrorDetail } from "@/lib/errors";
import { makeConfigField } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);
const ALLOW_REGISTRATION_KEY = "auth.allow_registration";
const ALLOW_REGISTRATION_LABEL = "Allow sign-ups";
const MAX_UPLOAD_LABEL = "Max upload size (MB)";
const MAX_UPLOAD_KEY = "uploads.max_upload_size_mb";
const SAVE_BUTTON = "Save changes";

function makeAllowRegistrationField(overrides: Parameters<typeof makeConfigField>[0] = {}) {
  return makeConfigField({
    key: ALLOW_REGISTRATION_KEY,
    label: ALLOW_REGISTRATION_LABEL,
    ...overrides,
  });
}

describe("AdminSettingsPage", () => {
  it("renders a control per catalog entry grouped by section", async () => {
    api.fetchAdminConfig.mockResolvedValueOnce([
      makeAllowRegistrationField(),
      makeConfigField({
        key: MAX_UPLOAD_KEY,
        label: MAX_UPLOAD_LABEL,
        kind: "int",
        value: 50,
        default: 50,
      }),
    ]);

    render(<AdminSettingsPage />);

    expect(await screen.findByRole("heading", { name: "Auth" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Uploads" })).toBeInTheDocument();
    expect(screen.getAllByText(ALLOW_REGISTRATION_LABEL).length).toBeGreaterThan(0);
    expect(screen.getAllByText(MAX_UPLOAD_LABEL).length).toBeGreaterThan(0);
  });

  it("disables an env-locked field and shows its pin badge", async () => {
    api.fetchAdminConfig.mockResolvedValueOnce([
      makeConfigField({
        key: "models.default_chat_model",
        label: "Default chat model",
        kind: "string",
        value: "openai/gpt-oss-120b",
        default: "openai/gpt-oss-120b",
        source: "env-locked",
        env_var: "OPENROUTER_DEFAULT_CHAT_MODEL",
      }),
    ]);

    render(<AdminSettingsPage />);

    const input = await screen.findByLabelText("Default chat model");
    expect(input).toBeDisabled();
    expect(screen.getByText("Pinned by OPENROUTER_DEFAULT_CHAT_MODEL")).toBeInTheDocument();
  });

  it("saves exactly the dirty fields — across sections — in one patch", async () => {
    const user = userEvent.setup();
    api.fetchAdminConfig.mockResolvedValueOnce([
      makeAllowRegistrationField({ value: true }),
      makeConfigField({
        key: "features.chat_branching",
        label: "Chat branching",
        value: true,
        default: true,
      }),
      makeConfigField({
        key: MAX_UPLOAD_KEY,
        label: MAX_UPLOAD_LABEL,
        kind: "int",
        value: 50,
        default: 50,
      }),
    ]);
    api.updateAdminConfig.mockResolvedValueOnce([
      makeAllowRegistrationField({ value: false, source: "db" }),
    ]);

    render(<AdminSettingsPage />);

    await user.click(await screen.findByRole("checkbox", { name: ALLOW_REGISTRATION_LABEL }));
    await user.click(screen.getByRole("checkbox", { name: "Chat branching" }));
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: SAVE_BUTTON }));

    await waitFor(() => {
      // One sparse patch carrying both sections; the untouched int is absent.
      expect(api.updateAdminConfig).toHaveBeenCalledWith("test-token", {
        auth: { allow_registration: false },
        features: { chat_branching: false },
      });
    });
  });

  it("discard clears pending edits without calling the API", async () => {
    const user = userEvent.setup();
    api.fetchAdminConfig.mockResolvedValueOnce([makeAllowRegistrationField({ value: true })]);

    render(<AdminSettingsPage />);

    await user.click(await screen.findByRole("checkbox", { name: ALLOW_REGISTRATION_LABEL }));
    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
    expect(api.updateAdminConfig).not.toHaveBeenCalled();
    // The control shows the server value again.
    expect(screen.getByRole("checkbox", { name: ALLOW_REGISTRATION_LABEL })).toBeChecked();
  });

  it("resets a field to default with a null-valued patch", async () => {
    const user = userEvent.setup();
    api.fetchAdminConfig.mockResolvedValueOnce([
      makeAllowRegistrationField({ value: false, source: "db" }),
    ]);
    api.updateAdminConfig.mockResolvedValueOnce([makeAllowRegistrationField({ value: true })]);

    render(<AdminSettingsPage />);

    const resetButton = await screen.findByRole("button", { name: "Reset to default" });
    await user.click(resetButton);

    await waitFor(() => {
      expect(api.updateAdminConfig).toHaveBeenCalledWith("test-token", {
        auth: { allow_registration: null },
      });
    });
  });

  it("surfaces a per-field 400 error from the API in the alert region", async () => {
    const user = userEvent.setup();
    api.fetchAdminConfig.mockResolvedValueOnce([makeAllowRegistrationField({ value: true })]);
    // apiFetch (src/lib/api/client.ts) formats a dict `detail` into readable
    // "field: message" lines before constructing ApiError — mirror that here
    // since this test mocks updateAdminConfig above the client layer.
    api.updateAdminConfig.mockRejectedValueOnce(
      new ApiError(400, formatApiErrorDetail({ allow_registration: "must be a boolean" })),
    );

    render(<AdminSettingsPage />);

    const checkbox = await screen.findByRole("checkbox", { name: ALLOW_REGISTRATION_LABEL });
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: SAVE_BUTTON }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("allow_registration: must be a boolean");
    expect(alert.textContent).not.toMatch(/[{}]/);
  });
});

describe("AdminSettingsPage validation and dirty state", () => {
  function boundedUploadField() {
    return makeConfigField({
      key: MAX_UPLOAD_KEY,
      label: MAX_UPLOAD_LABEL,
      kind: "int",
      value: 50,
      default: 50,
      min_value: 1,
      max_value: 1024,
    });
  }

  it("stops treating a field as changed once its original value is typed back", async () => {
    // Tracking which keys were touched rather than which values differ left
    // the page permanently unsaved, with Discard — which throws away every
    // other edit — as the only way out.
    api.fetchAdminConfig.mockResolvedValueOnce([boundedUploadField()]);
    render(<AdminSettingsPage />);

    const input = await screen.findByRole("spinbutton", { name: MAX_UPLOAD_LABEL });
    await userEvent.clear(input);
    await userEvent.type(input, "80");
    expect(screen.getByText(/unsaved change/)).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, "50");

    await waitFor(() => expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
  });

  it("refuses to save a value outside the field's own range, and says why", async () => {
    api.fetchAdminConfig.mockResolvedValueOnce([boundedUploadField()]);
    render(<AdminSettingsPage />);

    const input = await screen.findByRole("spinbutton", { name: MAX_UPLOAD_LABEL });
    await userEvent.clear(input);
    await userEvent.type(input, "0");

    expect(await screen.findByText("Must be at least 1.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SAVE_BUTTON })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    expect(api.updateAdminConfig).not.toHaveBeenCalled();
  });
});
