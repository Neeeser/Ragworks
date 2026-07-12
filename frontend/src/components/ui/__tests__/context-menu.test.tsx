import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu } from "@/components/ui/context-menu";

import type { ContextMenuItem } from "@/components/ui/context-menu";

const position = { x: 40, y: 40 };

function makeItems(onSelect = vi.fn(), onDisabled = vi.fn()): ContextMenuItem[] {
  return [
    { label: "Open", onSelect },
    { type: "separator" },
    { label: "Delete", danger: true, onSelect: vi.fn() },
    { label: "Paste", disabled: true, onSelect: onDisabled },
  ];
}

describe("ContextMenu", () => {
  it("renders nothing while closed", () => {
    render(<ContextMenu position={null} items={makeItems()} onClose={vi.fn()} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("selecting an item runs its action and closes the menu", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu position={position} items={makeItems(onSelect)} onClose={onClose} />);

    await user.click(screen.getByRole("menuitem", { name: "Open" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disabled items cannot be activated", async () => {
    const user = userEvent.setup();
    const onDisabled = vi.fn();
    render(
      <ContextMenu position={position} items={makeItems(vi.fn(), onDisabled)} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("menuitem", { name: "Paste" }));

    expect(onDisabled).not.toHaveBeenCalled();
  });

  it("Escape closes without selecting", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu position={position} items={makeItems(onSelect)} onClose={onClose} />);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking outside closes the menu", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <ContextMenu position={position} items={makeItems()} onClose={onClose} />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "outside" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("arrow keys move focus between enabled items, skipping disabled ones", async () => {
    const user = userEvent.setup();
    render(<ContextMenu position={position} items={makeItems()} onClose={vi.fn()} />);

    // Focus lands on the first enabled item on open.
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    // Wraps past the disabled Paste back to the top.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });
});
