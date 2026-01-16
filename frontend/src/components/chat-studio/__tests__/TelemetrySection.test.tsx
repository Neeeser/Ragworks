import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TelemetrySection } from "@/components/chat-studio/TelemetrySection";

describe("TelemetrySection", () => {
  it("renders header content and toggles open state", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <TelemetrySection title="System" description="Details" isOpen={false} onToggle={onToggle}>
        <div>Body</div>
      </TelemetrySection>,
    );

    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    const [headerButton] = screen.getAllByRole("button", { name: /System/ });
    fireEvent.click(headerButton);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <TelemetrySection
        title="System"
        description="Details"
        isOpen
        onToggle={onToggle}
        overrideActive
        sectionId="section-a"
      >
        <div>Body</div>
      </TelemetrySection>,
    );

    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /System toggle/ })).toBeInTheDocument();
    expect(document.getElementById("section-a")).toBeTruthy();
  });

  it("adds dragging styles when dragging", () => {
    const { container } = render(
      <TelemetrySection title="Drag" isOpen={false} onToggle={() => undefined} isDragging>
        <div />
      </TelemetrySection>,
    );
    expect(container.firstChild).toHaveClass("border-emerald-400/60");
  });
});
