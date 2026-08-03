/**
 * The editor's two readings of a template. The load-bearing contract:
 * Rendered shows what the markdown *becomes* — headings, lists, emphasis —
 * which syntax highlighting alone never tells you, and it honours the
 * variable view, so Rendered + Values is the payload as it will be sent.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PromptEditorPanel } from "@/components/prompts/PromptEditorPanel";
import { makePromptRead } from "@/test/fixtures";

import type { PromptDraft } from "@/components/prompts/hooks/use-prompt-studio";
import type { PromptCatalog, PromptDetail, PromptRenderResult } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const BODY = "## Guardrails\n\nAnswer as {{user.full_name}}.";

const detail: PromptDetail = {
  ...makePromptRead({ id: "prompt-1", name: "Base", context: "chat.base" }),
  body: BODY,
  system_body: null,
  output_fields: null,
  used_by: [],
};

const draft: PromptDraft = {
  body: BODY,
  systemBody: "",
  outputFields: [],
  values: { "user.full_name": "Avery Lee" },
};

const preview: PromptRenderResult = {
  rendered: "## Guardrails\n\nAnswer as Avery Lee.",
  rendered_system: null,
  unknown_variables: [],
  values: { "user.full_name": "Avery Lee" },
};

const catalog: PromptCatalog = {
  context: "chat.base",
  variables: [{ name: "user.full_name", description: "The user's name", example: "Avery Lee" }],
  namespaces: [],
};

const renderPanel = () =>
  render(
    <PromptEditorPanel
      detail={detail}
      draft={draft}
      onDraftChange={vi.fn()}
      preview={preview}
      catalog={catalog}
    />,
  );

describe("PromptEditorPanel views", () => {
  it("edits markdown source by default", () => {
    renderPanel();
    expect(screen.getByRole("textbox", { name: "System prompt" })).toBeInTheDocument();
    // Nothing is formatted yet — "## Guardrails" is still literal source.
    expect(screen.queryByRole("heading", { name: "Guardrails" })).not.toBeInTheDocument();
  });

  it("formats the markdown in the rendered view", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Rendered" }));

    expect(screen.getByRole("heading", { name: "Guardrails" })).toBeInTheDocument();
    // Rendered is a preview, so the editable surface steps aside rather than
    // silently swallowing keystrokes.
    expect(screen.queryByRole("textbox", { name: "System prompt" })).not.toBeInTheDocument();
    expect(screen.getByText(/switch to Source to edit/)).toBeInTheDocument();
  });

  it("keeps variable references literal in rendered + names", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Rendered" }));
    expect(screen.getByText(/Answer as \{\{user\.full_name\}\}\./)).toBeInTheDocument();
  });

  it("substitutes sample values in rendered + values — the payload as sent", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Rendered" }));
    await user.click(screen.getByRole("button", { name: "Values" }));
    expect(screen.getByText("Answer as Avery Lee.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Guardrails" })).toBeInTheDocument();
  });

  it("keeps full screen reachable from the rendered view", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Rendered" }));
    // The control used to live in the editor's toolbar, which Rendered
    // hides — stranding the user outside full screen.
    expect(screen.getByRole("button", { name: "Edit full screen" })).toBeInTheDocument();
  });
});
