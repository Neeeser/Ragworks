import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConsoleLayout from "@/app/(console)/layout";
import { getMockRouter, setMockPathname } from "@/test/test-utils";

import type { User } from "@/lib/types";

let mockAuthState: {
  user: User | null;
  loading: boolean;
  signOut: () => void;
};

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

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => mockAuthState,
}));

describe("ConsoleLayout", () => {
  beforeEach(() => {
    mockAuthState = {
      user: baseUser,
      loading: false,
      signOut: vi.fn(),
    };
    setMockPathname("/dashboard");
  });

  it("redirects to sign-in when user is missing", () => {
    mockAuthState = { user: null, loading: false, signOut: vi.fn() };
    render(<ConsoleLayout>Child</ConsoleLayout>);

    expect(screen.getByText(/Preparing your workspace/)).toBeInTheDocument();
    expect(getMockRouter().replace).toHaveBeenCalledWith("/auth/sign-in");
  });

  it("renders navigation and toggles the account menu", () => {
    render(<ConsoleLayout>Child</ConsoleLayout>);

    expect(screen.getByText("Control Room")).toBeInTheDocument();
    const avatarButton = document.querySelector('button[aria-haspopup="menu"]');
    if (!avatarButton) {
      throw new Error("Avatar button not found");
    }
    fireEvent.click(avatarButton);
    expect(screen.getByText("Sign out")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Settings"));
    expect(screen.queryByText("Sign out")).not.toBeInTheDocument();

    fireEvent.click(avatarButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Sign out")).not.toBeInTheDocument();

    fireEvent.click(avatarButton);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Sign out")).not.toBeInTheDocument();

    fireEvent.click(avatarButton);
    fireEvent.click(screen.getByText("Sign out"));
    expect(mockAuthState.signOut).toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Sign out")).not.toBeInTheDocument();
  });

  it("renders avatar fallbacks when profile data is minimal", () => {
    mockAuthState = {
      user: {
        ...baseUser,
        id: "",
        full_name: "",
        email: "solo@example.com",
      },
      loading: false,
      signOut: vi.fn(),
    };
    render(<ConsoleLayout>Child</ConsoleLayout>);

    const avatarButton = document.querySelector('button[aria-haspopup="menu"]');
    if (!avatarButton) {
      throw new Error("Avatar button not found");
    }
    expect(within(avatarButton).getByText("S")).toBeInTheDocument();
    expect(screen.getAllByText("solo@example.com").length).toBeGreaterThan(0);
  });

  it("renders chat and pipelines routes with special layout", () => {
    setMockPathname("/chat");
    const { rerender } = render(<ConsoleLayout>Chat Child</ConsoleLayout>);
    expect(screen.getByText("Chat Child")).toBeInTheDocument();

    setMockPathname("/pipelines");
    rerender(<ConsoleLayout>Pipeline Child</ConsoleLayout>);
    expect(screen.getByText("Pipeline Child")).toBeInTheDocument();
  });
});
