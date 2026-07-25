import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PALETTES, PALETTE_STORAGE_KEYS } from "@/lib/palettes";
import { ThemeProvider, useTheme } from "@/providers/theme-provider";

const STORAGE_KEY = "ragworks-theme";
const DARK_PALETTE_KEY = PALETTE_STORAGE_KEYS.dark;
const DEFAULT_DARK = DEFAULT_PALETTES.dark;
const OLED = "true-black";

function Probe() {
  const { theme, resolvedTheme, palettes, setTheme, toggleTheme, setPalette } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="dark-palette">{palettes.dark}</span>
      <button type="button" onClick={toggleTheme}>
        toggle
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        set-light
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        set-system
      </button>
      <button type="button" onClick={() => setPalette("dark", OLED)}>
        set-true-black
      </button>
      <button type="button" onClick={() => setPalette("dark", DEFAULT_DARK)}>
        set-deep-space
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
    document.documentElement.removeAttribute("data-palette");
  });
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-palette");
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

  it("applies the mode's default palette to the document", async () => {
    await act(async () => {
      renderProvider();
    });
    expect(document.documentElement.dataset.palette).toBe(DEFAULT_DARK);
  });

  it("persists a palette choice, applies it, and clears storage on the default", async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderProvider();
    });
    await user.click(screen.getByRole("button", { name: "set-true-black" }));
    expect(localStorage.getItem(DARK_PALETTE_KEY)).toBe(OLED);
    expect(document.documentElement.dataset.palette).toBe(OLED);
    // Picking the default again removes the override rather than pinning it.
    await user.click(screen.getByRole("button", { name: "set-deep-space" }));
    expect(localStorage.getItem(DARK_PALETTE_KEY)).toBeNull();
    expect(document.documentElement.dataset.palette).toBe(DEFAULT_DARK);
  });

  it("switching modes swaps to that mode's stored palette", async () => {
    const user = userEvent.setup();
    localStorage.setItem(DARK_PALETTE_KEY, "graphite");
    localStorage.setItem(PALETTE_STORAGE_KEYS.light, "linen");
    await act(async () => {
      renderProvider();
    });
    expect(document.documentElement.dataset.palette).toBe("graphite");
    await user.click(screen.getByRole("button", { name: "set-light" }));
    expect(document.documentElement.dataset.palette).toBe("linen");
  });

  it("falls back to the default when the stored palette is not one of the mode's", async () => {
    // A light palette stored under the dark key (hand-edited storage or a
    // removed palette) must not leak light values into dark mode.
    localStorage.setItem(DARK_PALETTE_KEY, "paper");
    await act(async () => {
      renderProvider();
    });
    expect(screen.getByTestId("dark-palette")).toHaveTextContent(DEFAULT_DARK);
    expect(document.documentElement.dataset.palette).toBe(DEFAULT_DARK);
  });
});
