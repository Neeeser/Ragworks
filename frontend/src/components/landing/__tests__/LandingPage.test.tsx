import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LandingPage } from "@/components/landing/LandingPage";

// The hero backdrop renders the real FlowPlayer, which mounts ReactFlow. Stub
// the library so the page renders in jsdom without a layout engine — we assert
// the page's content, not ReactFlow's internals.
vi.mock("@xyflow/react", () => ({
  ReactFlow: () => <div data-testid="reactflow" />,
  Background: () => <div />,
  Handle: () => <div />,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  BaseEdge: () => <div />,
  getSmoothStepPath: () => ["M0 0"],
}));

describe("LandingPage", () => {
  it("leads with the headline thesis", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Every RAG signal, surfaced.",
    );
  });

  it("offers a console entry and a source link", () => {
    render(<LandingPage />);

    const consoleCtas = screen.getAllByRole("link", { name: /console/i });
    expect(consoleCtas.some((link) => link.getAttribute("href") === "/auth/sign-in")).toBe(true);

    const sourceLinks = screen.getAllByRole("link", { name: /source|github/i });
    expect(
      sourceLinks.some(
        (link) => link.getAttribute("href") === "https://github.com/Neeeser/Ragworks",
      ),
    ).toBe(true);
  });

  it("mounts the running pipeline backdrop", () => {
    render(<LandingPage />);
    expect(screen.getByTestId("reactflow")).toBeInTheDocument();
  });

  it("renders with no network calls — the page carries no real data", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<LandingPage />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
