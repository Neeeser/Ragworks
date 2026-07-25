import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TabList } from "@/components/ui/tabs";

import type { TabItem } from "@/components/ui/tabs";

const TABS: Array<TabItem<"a" | "b" | "c">> = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta", disabled: true, disabledReason: "Beta needs a focused result." },
  { id: "c", label: "Gamma" },
];

function renderTabs(onSelect: (id: "a" | "b" | "c") => void) {
  return render(<TabList tabs={TABS} active="a" onSelect={onSelect} label="Scope" />);
}

describe("TabList", () => {
  it("does not select a disabled tab when it is clicked", async () => {
    const onSelect = vi.fn();
    renderTabs(onSelect);

    await userEvent.click(screen.getByRole("tab", { name: "Beta" }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps a disabled tab focusable so its reason is reachable by keyboard", async () => {
    const onSelect = vi.fn();
    renderTabs(onSelect);

    screen.getByRole("tab", { name: "Alpha" }).focus();
    await userEvent.keyboard("{ArrowRight}");

    const beta = screen.getByRole("tab", { name: "Beta" });
    expect(beta).toHaveFocus();
    expect(beta).toHaveAttribute("aria-disabled", "true");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Beta needs a focused result.");
  });

  it("steps past a disabled tab to select the next enabled one", async () => {
    const onSelect = vi.fn();
    renderTabs(onSelect);

    screen.getByRole("tab", { name: "Alpha" }).focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("selects an enabled tab on click", async () => {
    const onSelect = vi.fn();
    renderTabs(onSelect);

    await userEvent.click(screen.getByRole("tab", { name: "Gamma" }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
  });
});
