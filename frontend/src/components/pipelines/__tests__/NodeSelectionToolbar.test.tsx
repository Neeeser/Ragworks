import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelineNodeActionsProvider } from "@/components/pipelines/flow/node-actions-context";
import { NodeSelectionToolbar } from "@/components/pipelines/NodeSelectionToolbar";

import type { ReactNode } from "react";

vi.mock("@xyflow/react", () => ({
  NodeToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Position: { Top: "top" },
}));

const actions = () => ({ editNode: vi.fn(), deleteNode: vi.fn(), deselectNode: vi.fn() });

/** The card the toolbar belongs to, as React Flow renders it. */
const mountCard = () => {
  const card = document.createElement("div");
  card.className = "react-flow__node";
  card.dataset.id = "node-1";
  card.tabIndex = 0;
  document.body.append(card);
  return card;
};

const renderToolbar = (value = actions()) => {
  render(
    <PipelineNodeActionsProvider value={value}>
      <NodeSelectionToolbar nodeId="node-1" />
    </PipelineNodeActionsProvider>,
  );
  return value;
};

afterEach(() => {
  document.querySelectorAll(".react-flow__node").forEach((node) => node.remove());
});

describe("NodeSelectionToolbar", () => {
  it("is a labelled toolbar with one tab stop", () => {
    renderToolbar();

    expect(screen.getByRole("toolbar", { name: "Node actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit node" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Delete node" })).toHaveAttribute("tabindex", "-1");
  });

  it("walks between the actions with the arrow keys, and runs the focused one", async () => {
    const user = userEvent.setup();
    const value = renderToolbar();
    const edit = screen.getByRole("button", { name: "Edit node" });
    const remove = screen.getByRole("button", { name: "Delete node" });

    edit.focus();
    await user.keyboard("{ArrowRight}");
    expect(remove).toHaveFocus();
    expect(remove).toHaveAttribute("tabindex", "0");

    await user.keyboard("{Enter}");
    expect(value.deleteNode).toHaveBeenCalledWith("node-1");

    await user.keyboard("{ArrowRight}");
    expect(edit).toHaveFocus();
    await user.keyboard("{End}");
    expect(remove).toHaveFocus();
    await user.keyboard("{Home}");
    expect(edit).toHaveFocus();
  });

  it("hands focus back to the node card and drops the selection on Escape", async () => {
    const user = userEvent.setup();
    const card = mountCard();
    const value = renderToolbar();

    screen.getByRole("button", { name: "Edit node" }).focus();
    await user.keyboard("{Escape}");

    expect(value.deselectNode).toHaveBeenCalledWith("node-1");
    expect(card).toHaveFocus();
  });

  it("steps back to the node card on Shift+Tab, keeping the selection", async () => {
    const user = userEvent.setup();
    const card = mountCard();
    const value = renderToolbar();

    screen.getByRole("button", { name: "Edit node" }).focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(card).toHaveFocus();
    expect(value.deselectNode).not.toHaveBeenCalled();
  });

  it("renders nothing where the canvas supplies no actions", () => {
    render(<NodeSelectionToolbar nodeId="node-1" />);

    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});
