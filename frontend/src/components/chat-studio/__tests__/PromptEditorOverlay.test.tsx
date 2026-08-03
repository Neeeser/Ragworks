import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PromptEditorOverlay } from "@/components/chat-studio/PromptEditorOverlay";
import { makePromptRead, makePromptSelection } from "@/test/fixtures";

import type { PromptSection } from "@/components/chat-studio/hooks/settings/use-prompt-editor";

function makeSection(overrides: Partial<PromptSection> = {}): PromptSection {
  return {
    id: "base",
    label: "Base",
    scope: "base",
    selection: makePromptSelection(),
    choice: { promptId: "prompt-1", version: "latest" },
    choiceBody: "System prompt for {{user}}",
    hasChanges: false,
    saving: false,
    error: null,
    ...overrides,
  };
}

const libraryPrompts = [
  makePromptRead(),
  makePromptRead({ id: "prompt-2", name: "Alt base", current_version: 3 }),
  makePromptRead({ id: "prompt-tool", name: "Tool prompt", context: "chat.tool" }),
];

describe("PromptEditorOverlay", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <PromptEditorOverlay
        isOpen={false}
        onClose={vi.fn()}
        sections={[makeSection()]}
        activeSectionId="base"
        libraryPrompts={libraryPrompts}
        onSelectSection={vi.fn()}
        onChoice={vi.fn()}
        onSave={vi.fn()}
        promptPreviewMarkdown=""
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists only prompts matching the section's context", async () => {
    const user = userEvent.setup();
    render(
      <PromptEditorOverlay
        isOpen
        onClose={vi.fn()}
        sections={[makeSection()]}
        activeSectionId="base"
        libraryPrompts={libraryPrompts}
        onSelectSection={vi.fn()}
        onChoice={vi.fn()}
        onSave={vi.fn()}
        promptPreviewMarkdown="Preview"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Prompt" }));
    expect(screen.getByRole("option", { name: "Alt base" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Tool prompt" })).not.toBeInTheDocument();
  });

  it("reports a picked prompt as a latest-version choice", async () => {
    const user = userEvent.setup();
    const onChoice = vi.fn();
    render(
      <PromptEditorOverlay
        isOpen
        onClose={vi.fn()}
        sections={[makeSection()]}
        activeSectionId="base"
        libraryPrompts={libraryPrompts}
        onSelectSection={vi.fn()}
        onChoice={onChoice}
        onSave={vi.fn()}
        promptPreviewMarkdown="Preview"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Prompt" }));
    await user.click(screen.getByRole("option", { name: "Alt base" }));
    expect(onChoice).toHaveBeenCalledWith("base", { promptId: "prompt-2", version: "latest" });
  });

  it("pins a concrete version through the version dropdown", async () => {
    const user = userEvent.setup();
    const onChoice = vi.fn();
    render(
      <PromptEditorOverlay
        isOpen
        onClose={vi.fn()}
        sections={[makeSection()]}
        activeSectionId="base"
        libraryPrompts={libraryPrompts}
        onSelectSection={vi.fn()}
        onChoice={onChoice}
        onSave={vi.fn()}
        promptPreviewMarkdown="Preview"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Version" }));
    await user.click(screen.getByRole("option", { name: "v1" }));
    expect(onChoice).toHaveBeenCalledWith("base", { promptId: "prompt-1", version: 1 });
  });

  it("disables save until the choice differs from the saved reference", () => {
    render(
      <PromptEditorOverlay
        isOpen
        onClose={vi.fn()}
        sections={[makeSection({ hasChanges: false })]}
        activeSectionId="base"
        libraryPrompts={libraryPrompts}
        onSelectSection={vi.fn()}
        onChoice={vi.fn()}
        onSave={vi.fn()}
        promptPreviewMarkdown="Preview"
      />,
    );
    expect(screen.getByRole("button", { name: "Use this prompt" })).toBeDisabled();
  });

  it("saves the active section when a change is pending", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <PromptEditorOverlay
        isOpen
        onClose={vi.fn()}
        sections={[makeSection({ hasChanges: true })]}
        activeSectionId="base"
        libraryPrompts={libraryPrompts}
        onSelectSection={vi.fn()}
        onChoice={vi.fn()}
        onSave={onSave}
        promptPreviewMarkdown="Preview"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Use this prompt" }));
    expect(onSave).toHaveBeenCalledWith("base");
  });
});
