import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeProvider, useTheme } from "@/providers/theme-provider";

const STORAGE_KEY = "ragworks-theme";

function Probe() {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={toggleTheme}>
        toggle
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        set-light
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        set-system
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to system preference and applies it to the document (matchMedia → dark)", async () => {
    await act(async () => {
      renderProvider();
    });
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("hydrates a stored preference on mount", async () => {
    localStorage.setItem(STORAGE_KEY, "light");
    await act(async () => {
      renderProvider();
    });
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("persists an explicit choice and applies it", async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderProvider();
    });
    await user.click(screen.getByRole("button", { name: "set-light" }));
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("toggle flips light↔dark", async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderProvider();
    });
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("choosing system clears the stored preference", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, "light");
    await act(async () => {
      renderProvider();
    });
    await user.click(screen.getByRole("button", { name: "set-system" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
  });
});
