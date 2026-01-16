import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/providers/auth-provider";

import type { User } from "@/lib/types";

const api = {
  getProfile: vi.fn(),
  loginRequest: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  getProfile: (...args: unknown[]) => api.getProfile(...args),
  loginRequest: (...args: unknown[]) => api.loginRequest(...args),
}));

const baseUser: User = {
  id: "user-1",
  email: "user@example.com",
  is_active: true,
  openrouter_configured: true,
  pinecone_configured: true,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
};

function AuthStateView() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(auth.loading)}</div>
      <div data-testid="user">{auth.user?.id ?? "none"}</div>
      <div data-testid="token">{auth.token ?? "none"}</div>
      <div data-testid="error">{auth.error ?? ""}</div>
      <button type="button" onClick={() => auth.signIn("user@example.com", "secret")}>
        Sign in
      </button>
      <button type="button" onClick={() => auth.signOut()}>
        Sign out
      </button>
      <button type="button" onClick={() => auth.refreshProfile()}>
        Refresh
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.getProfile.mockReset();
    api.loginRequest.mockReset();
  });

  it("throws when used outside the provider", () => {
    const Problem = () => {
      useAuth();
      return <div>nope</div>;
    };
    expect(() => render(<Problem />)).toThrow("useAuth must be used within an AuthProvider");
  });

  it("handles missing stored token", async () => {
    render(
      <AuthProvider>
        <AuthStateView />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(api.getProfile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Refresh"));
    expect(api.getProfile).not.toHaveBeenCalled();
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("hydrates from storage and handles refresh failures", async () => {
    window.localStorage.setItem("transparentrag.jwt", "token");
    api.getProfile
      .mockResolvedValueOnce(baseUser)
      .mockResolvedValueOnce(baseUser)
      .mockRejectedValueOnce(new Error("No profile"));

    render(
      <AuthProvider>
        <AuthStateView />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user")).toHaveTextContent("user-1");
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Refresh"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("No profile");
    });
  });

  it("uses a fallback error message when refresh fails with non-errors", async () => {
    window.localStorage.setItem("transparentrag.jwt", "token");
    api.getProfile
      .mockResolvedValueOnce(baseUser)
      .mockResolvedValueOnce(baseUser)
      .mockRejectedValueOnce("bad");

    render(
      <AuthProvider>
        <AuthStateView />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user")).toHaveTextContent("user-1");
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Refresh"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Unable to load profile.");
    });
  });

  it("supports sign in and sign out flows", async () => {
    api.loginRequest.mockResolvedValueOnce({ access_token: "token", token_type: "bearer" });
    api.getProfile.mockResolvedValue(baseUser);

    render(
      <AuthProvider>
        <AuthStateView />
      </AuthProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Sign in"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("token")).toHaveTextContent("token");
      expect(screen.getByTestId("user")).toHaveTextContent("user-1");
    });

    fireEvent.click(screen.getByText("Sign out"));
    expect(screen.getByTestId("token")).toHaveTextContent("none");
  });
});
