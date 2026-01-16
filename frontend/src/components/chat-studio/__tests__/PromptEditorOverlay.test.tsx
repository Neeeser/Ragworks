import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { markdownComponents } from "@/components/chat-studio/chat-utils";
import { PromptEditorOverlay } from "@/components/chat-studio/PromptEditorOverlay";

import type { PromptDetails } from "@/lib/types";

describe("PromptEditorOverlay", () => {
  const details: PromptDetails = {
    template: "Hello",
    is_custom: true,
    variables: [{ name: "collection", description: "Collection name", example: "Support" }],
    context: { collection: "Support" },
  };

  it("returns null when closed or empty", () => {
    const { container, rerender } = render(
      <PromptEditorOverlay
        isOpen={false}
        onClose={() => undefined}
        sections={[]}
        activeSectionId={null}
        onSelectSection={() => undefined}
        onDraftChange={() => undefined}
        onSave={() => undefined}
        onReset={() => undefined}
        onInsertVariable={() => undefined}
        promptPreviewMarkdown=""
        inputRef={React.createRef()}
        markdownComponents={markdownComponents}
      />,
    );
    expect(container.firstChild).toBeNull();

    rerender(
      <PromptEditorOverlay
        isOpen
        onClose={() => undefined}
        sections={[]}
        activeSectionId={null}
        onSelectSection={() => undefined}
        onDraftChange={() => undefined}
        onSave={() => undefined}
        onReset={() => undefined}
        onInsertVariable={() => undefined}
        promptPreviewMarkdown=""
        inputRef={React.createRef()}
        markdownComponents={markdownComponents}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders sections, variables, and actions", () => {
    const onClose = vi.fn();
    const onSelectSection = vi.fn();
    const onDraftChange = vi.fn();
    const onSave = vi.fn();
    const onReset = vi.fn();
    const onInsertVariable = vi.fn();

    render(
      <PromptEditorOverlay
        isOpen
        onClose={onClose}
        sections={[
          {
            id: "base",
            label: "Base",
            scope: "base",
            details,
            draft: "Hello",
            hasChanges: true,
            saving: false,
            error: null,
          },
          {
            id: "tool",
            label: "Tool",
            scope: "collection",
            details: null,
            draft: "",
            hasChanges: false,
            saving: false,
            error: null,
          },
        ]}
        activeSectionId="base"
        onSelectSection={onSelectSection}
        onDraftChange={onDraftChange}
        onSave={onSave}
        onReset={onReset}
        onInsertVariable={onInsertVariable}
        promptPreviewMarkdown=""
        inputRef={React.createRef()}
        markdownComponents={markdownComponents}
      />,
    );

    expect(screen.getByText("Edit prompt sections")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Tool/ }));
    expect(onSelectSection).toHaveBeenCalledWith("tool");

    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));
    expect(onReset).toHaveBeenCalledWith("base");

    fireEvent.change(screen.getByPlaceholderText(/Write instructions/), {
      target: { value: "Next" },
    });
    expect(onDraftChange).toHaveBeenCalledWith("base", "Next");

    fireEvent.click(screen.getByRole("button", { name: /collection/ }));
    expect(onInsertVariable).toHaveBeenCalledWith("base", "collection");

    fireEvent.click(screen.getByRole("button", { name: "Save prompt" }));
    expect(onSave).toHaveBeenCalledWith("base");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows errors and disables saving", () => {
    render(
      <PromptEditorOverlay
        isOpen
        onClose={() => undefined}
        sections={[
          {
            id: "base",
            label: "Base",
            scope: "base",
            details,
            draft: "Hello",
            hasChanges: false,
            saving: true,
            error: "Save failed",
          },
        ]}
        activeSectionId="base"
        onSelectSection={() => undefined}
        onDraftChange={() => undefined}
        onSave={() => undefined}
        onReset={() => undefined}
        onInsertVariable={() => undefined}
        promptPreviewMarkdown="Preview"
        inputRef={React.createRef()}
        markdownComponents={markdownComponents}
      />,
    );

    expect(screen.getByText("Save failed")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: /Working/ });
    expect(saveButton).toBeDisabled();
  });

  it("shows empty variables and context", () => {
    render(
      <PromptEditorOverlay
        isOpen
        onClose={() => undefined}
        sections={[
          {
            id: "tool",
            label: "Tool",
            scope: "collection",
            details: { template: "", is_custom: false, variables: [], context: {} },
            draft: "",
            hasChanges: false,
            saving: false,
            error: null,
          },
        ]}
        activeSectionId="tool"
        onSelectSection={() => undefined}
        onDraftChange={() => undefined}
        onSave={() => undefined}
        onReset={() => undefined}
        onInsertVariable={() => undefined}
        promptPreviewMarkdown=""
        inputRef={React.createRef()}
        markdownComponents={markdownComponents}
      />,
    );

    expect(screen.getByText("No template variables available.")).toBeInTheDocument();
    expect(screen.getByText("Context not available yet.")).toBeInTheDocument();
  });

  it("falls back to the first section when active selection is missing", () => {
    render(
      <PromptEditorOverlay
        isOpen
        onClose={() => undefined}
        sections={[
          {
            id: "base",
            label: "Base",
            scope: "base",
            details: null,
            draft: "",
            hasChanges: false,
            saving: false,
            error: null,
          },
        ]}
        activeSectionId="missing"
        onSelectSection={() => undefined}
        onDraftChange={() => undefined}
        onSave={() => undefined}
        onReset={() => undefined}
        onInsertVariable={() => undefined}
        promptPreviewMarkdown=""
        inputRef={React.createRef()}
        markdownComponents={markdownComponents}
      />,
    );

    expect(screen.getByText("Base prompt template")).toBeInTheDocument();
    expect(screen.getByText("No template variables available.")).toBeInTheDocument();
    expect(screen.getByText("Context not available yet.")).toBeInTheDocument();
  });
});
