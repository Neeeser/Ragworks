import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ChatSessionPage from "@/app/(console)/chat/[sessionId]/page";
import ChatLayout from "@/app/(console)/chat/layout";
import ChatStudioPage from "@/app/(console)/chat/page";

vi.mock("@/components/chat-studio/ChatStudio", () => ({
  ChatStudio: () => <div data-testid="chat-studio" />,
}));

describe("chat pages", () => {
  it("renders chat layout with studio", () => {
    const { getByTestId, getByText } = render(
      <ChatLayout>
        <div>Child</div>
      </ChatLayout>,
    );
    expect(getByTestId("chat-studio")).toBeInTheDocument();
    expect(getByText("Child")).toBeInTheDocument();
  });

  it("renders chat route placeholders", () => {
    const { container: chatContainer } = render(<ChatStudioPage />);
    expect(chatContainer.firstChild).toBeNull();

    const { container: sessionContainer } = render(<ChatSessionPage />);
    expect(sessionContainer.firstChild).toBeNull();
  });
});
