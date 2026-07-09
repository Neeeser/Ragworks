import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConsoleLayout from "@/app/(console)/layout";
import { makeUser } from "@/test/fixtures";
import { setMockAuth } from "@/test/mocks";
import { getMockRouter, setMockPathname } from "@/test/test-utils";

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/providers/theme-provider", async () => (await import("@/test/mocks")).mockTheme());

const signOutName = "Sign out";

describe("ConsoleLayout", () => {
  let auth: ReturnType<typeof setMockAuth>;

  beforeEach(() => {
    auth = setMockAuth();
    setMockPathname("/dashboard");
  });

  it("redirects to sign-in when user is missing", () => {
    setMockAuth({ user: null });
    render(<ConsoleLayout>Child</ConsoleLayout>);

    expect(screen.getByText(/Preparing your workspace/)).toBeInTheDocument();
    expect(getMockRouter().replace).toHaveBeenCalledWith("/auth/sign-in");
  });

  it("renders navigation and toggles the account menu", () => {
    render(<ConsoleLayout>Child</ConsoleLayout>);

    expect(screen.getByText("Control Room")).toBeInTheDocument();
    const avatarButton = screen.getByRole("button", { expanded: false });
    fireEvent.click(avatarButton);
    expect(screen.getByText(signOutName)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Settings"));
    expect(screen.queryByText(signOutName)).not.toBeInTheDocument();

    fireEvent.click(avatarButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(signOutName)).not.toBeInTheDocument();

    fireEvent.click(avatarButton);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText(signOutName)).not.toBeInTheDocument();

    fireEvent.click(avatarButton);
    fireEvent.click(screen.getByText(signOutName));
    expect(auth.signOut).toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText(signOutName)).not.toBeInTheDocument();
  });

  it("renders avatar fallbacks when profile data is minimal", () => {
    setMockAuth({
      user: makeUser({ id: "", full_name: "", email: "solo@example.com" }),
    });
    render(<ConsoleLayout>Child</ConsoleLayout>);

    expect(screen.getByRole("button", { name: "S" })).toBeInTheDocument();
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
