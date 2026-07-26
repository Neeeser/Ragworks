import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrumbBar } from "@/components/ui/crumb-bar";
import { KpiCell, KpiStrip } from "@/components/ui/kpi-strip";

describe("CrumbBar on a narrow viewport", () => {
  it("wraps instead of overlapping its action", () => {
    const { container } = render(
      <CrumbBar
        crumbs={[{ label: "Collections", href: "/collections" }, { label: "My first collection" }]}
        state={<span>Updated 2m</span>}
        actions={<button type="button">Open in Chat studio</button>}
      />,
    );
    const bar = container.firstElementChild as HTMLElement;

    // A phone cannot hold crumbs + state + action on one line; without wrapping
    // the crumbs and the "Updated" state ran straight through the button.
    expect(bar.className).toContain("flex-wrap");
    expect(bar.className).toContain("sm:flex-nowrap");
    // The single-line 48px bar is unchanged from `sm` up.
    expect(bar.className).toContain("sm:h-12");
    expect(screen.getByRole("button", { name: "Open in Chat studio" })).toBeInTheDocument();
  });
});

describe("KpiStrip on a narrow viewport", () => {
  it("wraps its cells rather than dividing one row five ways", () => {
    render(
      <KpiStrip>
        <KpiCell label="Documents" value={3} />
        <KpiCell label="Chunks" value={42} />
        <KpiCell label="Avg query latency" value="120 ms" />
        <KpiCell label="Last queried" value="2m" />
        <KpiCell label="Range" value="7D" />
      </KpiStrip>,
    );

    const cell = screen.getByText("Documents").closest("div.grow") as HTMLElement;
    // Five cells across 375px give each label ~70px — overlapping text, not a
    // KPI. Two per row on a phone, three from `sm`, one row from `lg`.
    expect(cell.className).toContain("basis-1/2");
    expect(cell.className).toContain("sm:basis-1/3");
    expect(cell.className).toContain("lg:basis-0");
    expect((cell.parentElement as HTMLElement).className).toContain("flex-wrap");
    // Every cell still reads its value.
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
