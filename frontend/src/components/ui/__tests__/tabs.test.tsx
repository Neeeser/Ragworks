import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SectionTabs, TabList } from "@/components/ui/tabs";

import type { TabItem } from "@/components/ui/tabs";

vi.mock("next/navigation", () => ({ usePathname: () => "/c/1" }));

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

describe("SectionTabs", () => {
  it("keeps its overflow to itself so the sections cannot widen the page", () => {
    // Asserted on the classes because jsdom computes no layout: scrollWidth is
    // always 0 here, so the real symptom — a fixed-height strip that cannot
    // wrap pushing the whole page wider than the viewport — is not observable.
    render(
      <SectionTabs
        tabs={[
          { href: "/c/1", label: "Overview", exact: true },
          { href: "/c/1/files", label: "Files" },
          { href: "/c/1/visualize", label: "Visualize" },
        ]}
      />,
    );

    const strip = screen.getByRole("navigation", { name: "Sections" });
    expect(strip).toHaveClass("overflow-x-auto");
    // Without shrink-0 the labels compress to fit instead of scrolling.
    for (const label of ["Overview", "Files", "Visualize"]) {
      expect(screen.getByRole("link", { name: label })).toHaveClass("shrink-0");
    }
  });
});
