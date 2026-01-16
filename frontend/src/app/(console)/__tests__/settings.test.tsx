import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "@/app/(console)/settings/page";

import type { User, UserKeyValidation } from "@/lib/types";

const api = {
  updateUserSettings: vi.fn(),
  validateUserKeys: vi.fn(),
};

let mockAuth: {
  user: User | null;
  token: string | null;
  refreshProfile: () => Promise<void>;
} = {
  user: null,
  token: null,
  refreshProfile: vi.fn(),
};

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/lib/api", () => ({
  updateUserSettings: (...args: unknown[]) => api.updateUserSettings(...args),
  validateUserKeys: (...args: unknown[]) => api.validateUserKeys(...args),
}));

const baseUser: User = {
  id: "user-1",
  email: "user@example.com",
  full_name: "Test User",
  is_active: true,
  openrouter_configured: true,
  pinecone_configured: true,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
};
const formNotFoundMessage = "Form not found";

describe("SettingsPage", () => {
  beforeEach(() => {
    mockAuth = {
      user: baseUser,
      token: "token",
      refreshProfile: vi.fn().mockResolvedValue(undefined),
    };
    api.updateUserSettings.mockReset();
    api.validateUserKeys.mockReset();
  });

  it("shows validation state while checking", () => {
    api.validateUserKeys.mockImplementation(() => new Promise<UserKeyValidation>(() => {}));
    render(<SettingsPage />);

    expect(screen.getAllByText("Checking").length).toBeGreaterThan(0);
  });

  it("requires a token to save settings", async () => {
    mockAuth = { ...mockAuth, token: null };
    render(<SettingsPage />);
    const form = document.querySelector("form");
    if (!form) {
      throw new Error(formNotFoundMessage);
    }
    fireEvent.submit(form);
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

    const form = document.querySelector("form");
    if (!form) {
      throw new Error(formNotFoundMessage);
    }
    fireEvent.submit(form);
    expect(screen.getByText("No changes to save.")).toBeInTheDocument();
  });

  it("saves updated settings and refreshes validation", async () => {
    api.validateUserKeys
      .mockResolvedValueOnce({
        openrouter: { configured: true, valid: true },
        pinecone: { configured: true, valid: true },
      })
      .mockResolvedValueOnce({
        openrouter: { configured: true, valid: true },
        pinecone: { configured: true, valid: true },
      });
    api.updateUserSettings.mockResolvedValue(baseUser);

    render(<SettingsPage />);

    const connectedBadges = await screen.findAllByText("Connected");
    expect(connectedBadges.length).toBeGreaterThan(0);

    const inputs = screen.getAllByPlaceholderText("Key saved (hidden)");
    fireEvent.change(inputs[0], { target: { value: "or-abc" } });

    const form = document.querySelector("form");
    if (!form) {
      throw new Error(formNotFoundMessage);
    }
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(api.updateUserSettings).toHaveBeenCalledWith("token", {
        openrouter_api_key: "or-abc",
      });
    });
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  });

  it("submits pending removals", async () => {
    api.validateUserKeys.mockResolvedValue({
      openrouter: { configured: true, valid: true },
      pinecone: { configured: true, valid: true },
    });
    api.updateUserSettings.mockResolvedValue(baseUser);

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByText("Remove")[0]);
    expect(screen.getByText("Will remove on save.")).toBeInTheDocument();

    const form = document.querySelector("form");
    if (!form) {
      throw new Error(formNotFoundMessage);
    }
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(api.updateUserSettings).toHaveBeenCalledWith("token", {
        openrouter_api_key: "",
      });
    });
  });

  it("saves pinecone keys and supports pending clears", async () => {
    api.validateUserKeys.mockResolvedValue({
      openrouter: { configured: true, valid: true },
      pinecone: { configured: true, valid: true },
    });
    api.updateUserSettings.mockResolvedValue(baseUser);

    render(<SettingsPage />);

    const inputs = screen.getAllByPlaceholderText("Key saved (hidden)");
    fireEvent.change(inputs[1], { target: { value: "pc-123" } });

    const form = document.querySelector("form");
    if (!form) {
      throw new Error(formNotFoundMessage);
    }
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(api.updateUserSettings).toHaveBeenCalledWith("token", {
        pinecone_api_key: "pc-123",
      });
    });

    fireEvent.click(screen.getAllByText("Remove")[1]);
    expect(screen.getByText("Will remove on save.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(api.updateUserSettings).toHaveBeenCalledWith("token", {
        pinecone_api_key: "",
      });
    });
  });

  it("handles save errors and invalid status", async () => {
    api.validateUserKeys.mockResolvedValue({
      openrouter: { configured: true, valid: false, message: "Bad key" },
      pinecone: { configured: true, valid: false },
    });
    api.updateUserSettings.mockRejectedValue(new Error("Update failed"));

    render(<SettingsPage />);

    const invalidBadges = await screen.findAllByText("Invalid");
    expect(invalidBadges.length).toBeGreaterThan(0);

    const form = document.querySelector("form");
    if (!form) {
      throw new Error(formNotFoundMessage);
    }
    const inputs = screen.getAllByPlaceholderText("Key saved (hidden)");
    fireEvent.change(inputs[0], { target: { value: "or-invalid" } });
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(await screen.findByText("Update failed")).toBeInTheDocument();
  });

  it("falls back to default status when validation is missing", async () => {
    mockAuth = { user: null, token: "token", refreshProfile: vi.fn() };
    api.validateUserKeys.mockRejectedValue("Validation down");

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
    api.validateUserKeys.mockResolvedValue({
      openrouter: { configured: true, valid: true },
      pinecone: { configured: true, valid: true },
    });
    api.updateUserSettings.mockRejectedValue("Update failed");

    render(<SettingsPage />);

    const inputs = await screen.findAllByPlaceholderText("Key saved (hidden)");
    fireEvent.change(inputs[0], { target: { value: "or-abc" } });

    const form = document.querySelector("form");
    if (!form) {
      throw new Error(formNotFoundMessage);
    }
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(await screen.findByText("Unable to update settings.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    await waitFor(() => {
      expect(screen.queryByText("Unable to update settings.")).not.toBeInTheDocument();
    });
  });

  it("shows validation error message when key checks fail", async () => {
    api.validateUserKeys.mockRejectedValue(new Error("Validation down"));
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Validation down")).toBeInTheDocument();
    });
  });
});
