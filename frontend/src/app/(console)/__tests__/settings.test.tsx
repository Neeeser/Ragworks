import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "@/app/(console)/settings/page";
import * as apiModule from "@/lib/api";
import { makeUser } from "@/test/fixtures";
import { setMockAuth } from "@/test/mocks";

import type { UserKeyValidation } from "@/lib/types";

vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "token" }),
);
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const KEY_PLACEHOLDER = "Key saved (hidden)";
const SAVE_BUTTON = "Save settings";
const TOKEN = "token";
const UPDATE_FAILED = "Update failed";
const VALIDATION_DOWN = "Validation down";

const submitForm = () => fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));

describe("SettingsPage", () => {
  beforeEach(() => {
    setMockAuth({ user: makeUser({ full_name: "Test User" }) });
  });

  it("shows validation state while checking", () => {
    api.validateUserKeys.mockImplementation(() => new Promise<UserKeyValidation>(() => {}));
    render(<SettingsPage />);

    expect(screen.getAllByText("Checking").length).toBeGreaterThan(0);
  });

  it("requires a token to save settings", () => {
    setMockAuth({ token: null });
    render(<SettingsPage />);

    submitForm();
    expect(screen.getByText("Sign in to update your settings.")).toBeInTheDocument();
  });

  it("handles no-op saves", async () => {
    api.validateUserKeys.mockResolvedValue({
      openrouter: { configured: false, valid: false },
      pinecone: { configured: false, valid: false },
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
    });

    submitForm();
    expect(screen.getByText("No changes to save.")).toBeInTheDocument();
  });

  it("saves updated settings and refreshes validation", async () => {
    render(<SettingsPage />);

    const connectedBadges = await screen.findAllByText("Connected");
    expect(connectedBadges.length).toBeGreaterThan(0);

    const inputs = screen.getAllByPlaceholderText(KEY_PLACEHOLDER);
    fireEvent.change(inputs[0], { target: { value: "or-abc" } });

    await act(async () => {
      submitForm();
    });

    await waitFor(() => {
      expect(api.updateUserSettings).toHaveBeenCalledWith(TOKEN, {
        openrouter_api_key: "or-abc",
      });
    });
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  });

  it("submits pending removals", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByText("Remove")[0]);
    expect(screen.getByText("Will remove on save.")).toBeInTheDocument();

    await act(async () => {
      submitForm();
    });

    await waitFor(() => {
      expect(api.updateUserSettings).toHaveBeenCalledWith(TOKEN, {
        openrouter_api_key: "",
      });
    });
  });

  it("saves pinecone keys and supports pending clears", async () => {
    render(<SettingsPage />);

    const inputs = screen.getAllByPlaceholderText(KEY_PLACEHOLDER);
    fireEvent.change(inputs[1], { target: { value: "pc-123" } });

    await act(async () => {
      submitForm();
    });

    await waitFor(() => {
      expect(api.updateUserSettings).toHaveBeenCalledWith(TOKEN, {
        pinecone_api_key: "pc-123",
      });
    });

    fireEvent.click(screen.getAllByText("Remove")[1]);
    expect(screen.getByText("Will remove on save.")).toBeInTheDocument();

    await act(async () => {
      submitForm();
    });

    await waitFor(() => {
      expect(api.updateUserSettings).toHaveBeenCalledWith(TOKEN, {
        pinecone_api_key: "",
      });
    });
  });

  it("handles save errors and invalid status", async () => {
    api.validateUserKeys.mockResolvedValue({
      openrouter: { configured: true, valid: false, message: "Bad key" },
      pinecone: { configured: true, valid: false },
    });
    api.updateUserSettings.mockRejectedValue(new Error(UPDATE_FAILED));

    render(<SettingsPage />);

    const invalidBadges = await screen.findAllByText("Invalid");
    expect(invalidBadges.length).toBeGreaterThan(0);

    const inputs = screen.getAllByPlaceholderText(KEY_PLACEHOLDER);
    fireEvent.change(inputs[0], { target: { value: "or-invalid" } });
    await act(async () => {
      submitForm();
    });

    expect(await screen.findByText(UPDATE_FAILED)).toBeInTheDocument();
  });

  it("falls back to default status when validation is missing", async () => {
    setMockAuth({ user: null });
    api.validateUserKeys.mockRejectedValue(VALIDATION_DOWN);

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Unable to validate API keys.")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
  });

  it("shows invalid status without a validation message", async () => {
    api.validateUserKeys.mockResolvedValue({
      openrouter: { configured: true, valid: false },
      pinecone: { configured: true, valid: true },
    });
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Invalid OpenRouter API key.")).toBeInTheDocument();
    });
  });

  it("handles save errors without Error objects and dismisses notifications", async () => {
    api.updateUserSettings.mockRejectedValue(UPDATE_FAILED);

    render(<SettingsPage />);

    const inputs = await screen.findAllByPlaceholderText(KEY_PLACEHOLDER);
    fireEvent.change(inputs[0], { target: { value: "or-abc" } });

    await act(async () => {
      submitForm();
    });

    expect(await screen.findByText("Unable to update settings.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    await waitFor(() => {
      expect(screen.queryByText("Unable to update settings.")).not.toBeInTheDocument();
    });
  });

  it("shows validation error message when key checks fail", async () => {
    api.validateUserKeys.mockRejectedValue(new Error(VALIDATION_DOWN));
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(VALIDATION_DOWN)).toBeInTheDocument();
    });
  });

  it("updates remembered login duration and revokes a session", async () => {
    api.listAuthSessions.mockResolvedValueOnce([
      {
        id: "session-1",
        user_agent: "Test browser",
        ip_address: "127.0.0.1",
        created_at: "2026-07-01T00:00:00Z",
        last_used_at: "2026-07-12T00:00:00Z",
        expires_at: "2026-08-01T00:00:00Z",
        current: false,
      },
    ]);
    render(<SettingsPage />);

    fireEvent.change(await screen.findByLabelText("Remembered login duration"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save login duration" }));

    await waitFor(() => {
      expect(api.updateUserSettings).toHaveBeenCalledWith(TOKEN, {
        remember_session_days: 90,
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Revoke Test browser" }));
    });
    expect(api.revokeAuthSession).toHaveBeenCalledWith(TOKEN, "session-1");
  });
});
