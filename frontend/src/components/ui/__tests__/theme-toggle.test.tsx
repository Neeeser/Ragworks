import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ThemeProvider } from "@/providers/theme-provider";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("labels the action for the current theme and flips it on click", async () => {
    const user = userEvent.setup();
    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>,
      );
    });

    // Dark by default (matchMedia stub → not light): offers to switch to light.
    const button = screen.getByRole("button", { name: "Switch to light theme" });
    await user.click(button);
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
