import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { ChatInput } from "@/components/chat-studio/ChatInput";

describe("ChatInput", () => {
  it("renders draft and sends when enabled", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const setDraft = vi.fn();
    const inputRef = React.createRef<HTMLTextAreaElement>();

    render(
      <ChatInput
        draft="Hello"
        setDraft={setDraft}
        sending={false}
        isStopping={false}
        onSend={onSend}
        onStop={onStop}
        inputRef={inputRef}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Ask/);
    fireEvent.change(textarea, { target: { value: "Next" } });
    expect(setDraft).toHaveBeenCalledWith("Next");

    const sendButton = screen.getByRole("button", { name: "Send turn" });
    expect(sendButton).toBeEnabled();
    fireEvent.click(sendButton);
    expect(onSend).toHaveBeenCalled();
  });

  it("disables send and shows stop state", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const setDraft = vi.fn();

    const { rerender } = render(
      <ChatInput
        draft="   "
        setDraft={setDraft}
        sending={false}
        isStopping={false}
        onSend={onSend}
        onStop={onStop}
        inputRef={React.createRef()}
      />,
    );

    expect(screen.getByRole("button", { name: "Send turn" })).toBeDisabled();

    rerender(
      <ChatInput
        draft="Stop it"
        setDraft={setDraft}
        sending
        isStopping={false}
        onSend={onSend}
        onStop={onStop}
        inputRef={React.createRef()}
      />,
    );

    const stopButton = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalled();

    rerender(
      <ChatInput
        draft="Stop it"
        setDraft={setDraft}
        sending
        isStopping
        onSend={onSend}
        onStop={onStop}
        inputRef={React.createRef()}
      />,
    );

    expect(screen.getByRole("button", { name: "Stopping..." })).toBeInTheDocument();
  });
});
