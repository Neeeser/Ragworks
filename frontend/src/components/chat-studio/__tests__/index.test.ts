import { describe, expect, it } from "vitest";

import * as chatStudio from "@/components/chat-studio";

describe("chat-studio index", () => {
  it("exports core components", () => {
    expect(chatStudio.ChatInput).toBeDefined();
    expect(chatStudio.PromptEditorOverlay).toBeDefined();
  });
});
