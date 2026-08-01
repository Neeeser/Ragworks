import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CapabilityFilterChips } from "@/components/models/CapabilityFilterChips";

describe("CapabilityFilterChips", () => {
  it("names each capability exactly once", () => {
    render(
      <CapabilityFilterChips available={["tools", "image_in"]} selected={[]} onToggle={vi.fn()} />,
    );

    // The chip already shows the capability's name, so its icon must be
    // decorative: an icon that also carries the label reads it twice.
    expect(screen.getByRole("button", { name: "Tool calling" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Image input (vision)" })).toBeInTheDocument();
  });

  it("reports its pressed state and toggles", async () => {
    const onToggle = vi.fn();
    render(
      <CapabilityFilterChips
        available={["tools", "image_in"]}
        selected={["tools"]}
        onToggle={onToggle}
      />,
    );
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "Tool calling" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Image input (vision)" }));

    expect(onToggle).toHaveBeenCalledWith("image_in");
  });

  it("renders nothing when the catalog offers no capabilities", () => {
    const { container } = render(
      <CapabilityFilterChips available={[]} selected={[]} onToggle={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
