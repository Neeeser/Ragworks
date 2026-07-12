import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as apiModule from "@/lib/api";
import { AuthProvider, useAuth } from "@/providers/auth-provider";
import { makeUser } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const baseUser = makeUser();

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
    api.refreshSession.mockRejectedValue(new Error("No session"));
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

  it("hydrates from the refresh cookie and handles profile failures", async () => {
    api.refreshSession.mockResolvedValueOnce({ access_token: "token", token_type: "bearer" });
    api.getProfile.mockResolvedValueOnce(baseUser).mockRejectedValueOnce(new Error("No profile"));

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

  it("uses a fallback error message when profile refresh fails with non-errors", async () => {
    api.refreshSession.mockResolvedValueOnce({ access_token: "token", token_type: "bearer" });
    api.getProfile.mockResolvedValueOnce(baseUser).mockRejectedValueOnce("bad");

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
    expect(api.logoutRequest).toHaveBeenCalled();
    expect(window.localStorage.getItem("ragworks.jwt")).toBeNull();
  });
});
