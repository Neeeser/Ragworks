import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusDot } from "@/components/ui/status-dot";

describe("StatusDot", () => {
  it("announces nothing for a bare dot", () => {
    // A bare dot is only used where the row names the state elsewhere, so the
    // reader should hear that row — not a palette key. Announcing the tone put
    // "pos" and "neutral" into the accessibility tree of every collection row,
    // dataset row, and setup step.
    const { container } = render(<StatusDot tone="pos" />);

    expect(container.textContent).toBe("");
    expect(screen.queryByText("pos")).not.toBeInTheDocument();
  });

  it("announces the caller's own words when the dot is the only carrier", () => {
    render(<StatusDot tone="neutral" srLabel="Not covered" />);

    expect(screen.getByText("Not covered")).toBeInTheDocument();
    expect(screen.queryByText("neutral")).not.toBeInTheDocument();
  });

  it("renders a visible label as text, without a second hidden copy", () => {
    render(<StatusDot tone="warn" label="Deactivated" srLabel="ignored" />);

    expect(screen.getByText("Deactivated")).toBeInTheDocument();
    expect(screen.queryByText("ignored")).not.toBeInTheDocument();
  });
});
