import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatStudioHeader } from "@/components/chat-studio/ChatStudioHeader";

const baseProps = {
  sessionTitle: null,
  collectionLabel: "2 collections",
  collectionMetaLabel: "Docs, Notes",
  toolsEnabled: false,
  currentModelLabel: null as string | null,
  streaming: false,
  onModelSelect: vi.fn(),
};

describe("ChatStudioHeader", () => {
  it("names the model control as an action while nothing is selected", () => {
    render(<ChatStudioHeader {...baseProps} onModelSelect={vi.fn()} />);

    const control = screen.getByRole("button", { name: /select model/i });
    // Real control chrome at rest, so a first-time user can tell it is the way
    // in rather than a label they have to guess at.
    expect(control).toHaveClass("border");
    expect(control).toHaveClass("bg-surface");
  });

  it("opens the model picker from the keyboard when nothing is selected", async () => {
    const onModelSelect = vi.fn();
    const user = userEvent.setup();

    render(<ChatStudioHeader {...baseProps} onModelSelect={onModelSelect} />);

    await user.tab();
    expect(screen.getByRole("button", { name: /select model/i })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(onModelSelect).toHaveBeenCalledTimes(1);
  });

  it("reads out the selected model instead of prompting for one", async () => {
    const onModelSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <ChatStudioHeader
        {...baseProps}
        currentModelLabel="anthropic/claude-sonnet-4"
        onModelSelect={onModelSelect}
      />,
    );

    expect(screen.queryByRole("button", { name: /select model/i })).not.toBeInTheDocument();
    const readout = screen.getByRole("button", { name: /anthropic\/claude-sonnet-4/ });
    expect(readout).not.toHaveClass("border");

    await user.click(readout);
    expect(onModelSelect).toHaveBeenCalledTimes(1);
  });
});
