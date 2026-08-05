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
        attachments={[]}
        attachmentError={null}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
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
        attachments={[]}
        attachmentError={null}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
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
        attachments={[]}
        attachmentError={null}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
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
        attachments={[]}
        attachmentError={null}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        draft="Stop it"
        setDraft={setDraft}
        sending
        isStopping
        onSend={onSend}
        onStop={onStop}
        inputRef={React.createRef()}
      />,
    );

    expect(screen.getByRole("button", { name: "Stopping" })).toBeInTheDocument();
  });

  it("sends on Cmd/Ctrl+Enter and names the shortcut in the tooltip", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(
      <ChatInput
        attachments={[]}
        attachmentError={null}
        onAttachFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        draft="Ship it"
        setDraft={vi.fn()}
        sending={false}
        isStopping={false}
        onSend={onSend}
        onStop={onStop}
        inputRef={React.createRef()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);

    // Plain Enter inserts a newline; only the modifier chord sends.
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);

    expect(screen.getAllByRole("tooltip").at(-1)!).toHaveTextContent(/Send turn — (⌘↵|Ctrl\+↵)/);
  });
});

describe("attachments", () => {
  const baseProps = {
    draft: "",
    setDraft: vi.fn(),
    sending: false,
    isStopping: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    inputRef: { current: null },
    attachmentError: null,
    onAttachFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
  };

  it("disables attach with the stated reason when the model lacks image input", () => {
    render(
      <ChatInput
        {...baseProps}
        attachments={[]}
        attachDisabledReason="The selected model does not state image input."
      />,
    );

    expect(screen.getByRole("button", { name: "Attach images" })).toBeDisabled();
  });

  it("shows attached previews with a working remove control, and enables send", () => {
    const onRemoveAttachment = vi.fn();
    render(
      <ChatInput
        {...baseProps}
        onRemoveAttachment={onRemoveAttachment}
        attachments={[
          {
            id: "a1",
            name: "galaxy.jpg",
            mediaType: "image/jpeg",
            data: "AA==",
            previewUrl: "blob:preview",
          },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "galaxy.jpg" })).toBeInTheDocument();
    // An image-only message is sendable: the backend accepts empty text
    // when attachments ride along.
    expect(screen.getByRole("button", { name: "Send turn" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove galaxy.jpg" }));
    expect(onRemoveAttachment).toHaveBeenCalledWith("a1");
  });
});
