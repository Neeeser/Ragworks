import { readFileSync } from "node:fs";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConsoleLayout from "@/app/(console)/layout";
import { fetchSetupStatus } from "@/lib/api";
import { makeUser } from "@/test/fixtures";
import { setMockAuth } from "@/test/mocks";
import { getMockRouter, setMockPathname } from "@/test/test-utils";

import type { SetupStatus } from "@/lib/types";

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/providers/theme-provider", async () => (await import("@/test/mocks")).mockTheme());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const statusMock = vi.mocked(fetchSetupStatus);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const signOutName = "Sign out";
const controlRoomLabel = "Control Room";

describe("ConsoleLayout", () => {
  let auth: ReturnType<typeof setMockAuth>;

  beforeEach(() => {
    auth = setMockAuth();
    setMockPathname("/dashboard");
  });

  it("renders both decorative theme marks for pre-paint selection", async () => {
    const globalStyles = readFileSync("src/app/globals.css", "utf8");
    const style = document.createElement("style");
    style.textContent = globalStyles.match(/\/\* The no-flash[\s\S]*?(?=\/\* Tailwind)/)?.[0] ?? "";
    expect(style.textContent).toContain(".ragworks-mark-dark");
    document.head.append(style);
    render(<ConsoleLayout>Child</ConsoleLayout>);

    const brandLink = (await screen.findByText(controlRoomLabel)).closest("a");
    const marks = brandLink?.querySelectorAll("img") ?? [];

    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveAttribute("src", "/ragworks-mark-dark.svg");
    expect(marks[1]).toHaveAttribute("src", "/ragworks-mark-light.svg");
    expect(marks[0]).toHaveAttribute("alt", "");
    expect(marks[1]).toHaveAttribute("alt", "");

    document.documentElement.dataset.theme = "dark";
    expect(getComputedStyle(marks[0]).display).toBe("block");
    expect(getComputedStyle(marks[1]).display).toBe("none");

    document.documentElement.dataset.theme = "light";
    expect(getComputedStyle(marks[0]).display).toBe("none");
    expect(getComputedStyle(marks[1]).display).toBe("block");
  });

  it("redirects to sign-in when user is missing", () => {
    setMockAuth({ user: null });
    render(<ConsoleLayout>Child</ConsoleLayout>);

    expect(screen.getByText(/Preparing your workspace/)).toBeInTheDocument();
    expect(getMockRouter().replace).toHaveBeenCalledWith("/auth/sign-in");
  });

  it("keeps the console hidden while redirecting an incomplete setup", async () => {
    const statusRequest = deferred<SetupStatus>();
    statusMock.mockReturnValueOnce(statusRequest.promise);

    render(<ConsoleLayout>Overview content</ConsoleLayout>);

    expect(screen.getByRole("status")).toHaveTextContent("Preparing your workspace");
    expect(screen.queryByText(controlRoomLabel)).not.toBeInTheDocument();
    expect(screen.queryByText("Overview content")).not.toBeInTheDocument();

    await act(async () => {
      statusRequest.resolve({
        has_embedding_provider: false,
        has_chat_provider: false,
        has_vector_store: false,
        has_index: false,
        has_collection: false,
        setup_complete: false,
      });
    });

    await waitFor(() => expect(getMockRouter().replace).toHaveBeenCalledWith("/setup"));
    expect(screen.queryByText(controlRoomLabel)).not.toBeInTheDocument();
    expect(screen.queryByText("Overview content")).not.toBeInTheDocument();
  });

  it("renders navigation and toggles the account menu", async () => {
    render(<ConsoleLayout>Child</ConsoleLayout>);

    expect(await screen.findByText(controlRoomLabel)).toBeInTheDocument();
    const avatarButton = screen.getByRole("button", { expanded: false });
    fireEvent.click(avatarButton);
    expect(screen.getByText(signOutName)).toBeInTheDocument();

    const settingsLink = screen.getByRole("link", { name: "Settings" });
    settingsLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(settingsLink);
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

  it("renders avatar fallbacks when profile data is minimal", async () => {
    setMockAuth({
      user: makeUser({ id: "", full_name: "", email: "solo@example.com" }),
    });
    render(<ConsoleLayout>Child</ConsoleLayout>);

    expect(await screen.findByRole("button", { name: "S" })).toBeInTheDocument();
    expect(screen.getAllByText("solo@example.com").length).toBeGreaterThan(0);
  });

  it("renders chat and pipelines routes with special layout", async () => {
    setMockPathname("/chat");
    const { rerender } = render(<ConsoleLayout>Chat Child</ConsoleLayout>);
    expect(await screen.findByText("Chat Child")).toBeInTheDocument();

    setMockPathname("/pipelines");
    rerender(<ConsoleLayout>Pipeline Child</ConsoleLayout>);
    expect(await screen.findByText("Pipeline Child")).toBeInTheDocument();
  });
});
