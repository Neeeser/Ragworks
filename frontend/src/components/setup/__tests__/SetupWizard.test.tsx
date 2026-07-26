import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/components/setup/SetupFlowBackdrop", () => ({
  SetupFlowBackdrop: () => <div data-testid="backdrop" />,
}));
vi.mock("@/providers/setup-status-provider", () => ({
  useSetupStatus: () => ({ status: null, refresh: vi.fn(), markComplete: vi.fn() }),
}));

import { SetupWizard } from "@/components/setup/SetupWizard";

describe("SetupWizard", () => {
  it("scrolls the step column so a tall step can always reach its footer", async () => {
    await act(async () => {
      render(<SetupWizard />);
    });

    const nav = screen.getByRole("navigation", { name: "Setup progress" });
    const stepColumn = nav.parentElement as HTMLElement;
    const root = stepColumn.parentElement as HTMLElement;

    // The console shell hands this route a fixed-height column and clips the
    // full-bleed backdrop, so nothing above the step column can scroll: the
    // column itself has to, or a step taller than the viewport strands its
    // Continue button below the fold.
    expect(stepColumn.className).toContain("overflow-y-auto");
    expect(stepColumn.className).toContain("max-h-full");
    // The root must not claim more height than the shell gives it, or the
    // column's max-height resolves past the bottom of the viewport.
    expect(root.className).not.toContain("min-h-[calc(100vh");
    expect(root.className).toContain("min-h-0");
  });
});
