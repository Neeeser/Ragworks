import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RootLayout from "@/app/layout";
import LandingPage from "@/app/page";

import type { ReactNode } from "react";

vi.mock("@/providers/auth-provider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
}));

describe("app root", () => {
  it("renders the root layout and children", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <div>Child content</div>
      </RootLayout>,
    );

    expect(markup).toContain("Child content");
    expect(markup).toContain("--font-geist-sans");
    expect(markup).toContain("--font-geist-mono");
    expect(markup).toContain('data-testid="auth-provider"');
  });

  it("renders the landing page", () => {
    render(<LandingPage />);

    expect(screen.getByText("TransparentRAG")).toBeInTheDocument();
    expect(screen.getByText("Every RAG signal, surfaced.")).toBeInTheDocument();
    expect(screen.getByText("Parse")).toBeInTheDocument();
    expect(screen.getByText("Chunk")).toBeInTheDocument();
    expect(screen.getByText("Embed")).toBeInTheDocument();
    expect(screen.getByText("Index")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });
});
