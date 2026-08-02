import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TelemetrySection } from "@/components/chat-studio/TelemetrySection";

/** The raised fill the open header carries; the body must never share it. */
const HEADER_FILL = ".bg-surface-strong";

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

  it("recesses the body below a raised header when open", () => {
    const { container, rerender } = render(
      <TelemetrySection title="System" isOpen={false} onToggle={() => undefined}>
        <div>Body</div>
      </TelemetrySection>,
    );
    const section = container.firstChild as HTMLElement;
    expect(section).not.toHaveClass("bg-canvas");
    expect(section.querySelector(HEADER_FILL)).toBeNull();

    rerender(
      <TelemetrySection title="System" isOpen onToggle={() => undefined}>
        <div>Body</div>
      </TelemetrySection>,
    );
    expect(container.firstChild).toHaveClass("bg-canvas");
    expect(screen.getByText("Body").parentElement).not.toHaveClass("bg-surface-strong");
    expect((container.firstChild as HTMLElement).querySelector(HEADER_FILL)).not.toBeNull();
  });

  it("keeps the drag tint unbroken by the header fill", () => {
    const { container } = render(
      <TelemetrySection title="Drag" isOpen onToggle={() => undefined} isDragging>
        <div>Body</div>
      </TelemetrySection>,
    );
    expect(container.firstChild).toHaveClass("bg-data-pos/5");
    expect((container.firstChild as HTMLElement).querySelector(HEADER_FILL)).toBeNull();
  });

  it("adds dragging styles when dragging", () => {
    const { container } = render(
      <TelemetrySection title="Drag" isOpen={false} onToggle={() => undefined} isDragging>
        <div />
      </TelemetrySection>,
    );
    expect(container.firstChild).toHaveClass("border-data-pos/60");
  });
});
