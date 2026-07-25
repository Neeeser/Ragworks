"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

import { DEFAULT_PALETTES, isPaletteForMode, PALETTE_STORAGE_KEYS } from "@/lib/palettes";
import { THEME_STORAGE_KEY } from "@/lib/theme-script";

import type { PaletteMode } from "@/lib/palettes";
import type { ReactNode } from "react";

/** User preference. "system" tracks the OS; "light"/"dark" pin a choice. */
export type ThemePreference = "light" | "dark" | "system";
/** The theme actually applied to the document. */
export type ResolvedTheme = "light" | "dark";

type ThemeState = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  /** The chosen palette per mode; the resolved mode decides which applies. */
  palettes: Record<PaletteMode, string>;
};

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  palettes: Record<PaletteMode, string>;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
  setPalette: (mode: PaletteMode, palette: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MEDIA_QUERY = "(prefers-color-scheme: light)";
// Server/first-paint default. The pre-paint script (theme-script.ts) has
// already resolved and applied the real attributes before hydration, so this
// only needs to be the deterministic value both renders agree on.
const SERVER_STATE: ThemeState = {
  theme: "system",
  resolvedTheme: "dark",
  palettes: DEFAULT_PALETTES,
};

/**
 * Module-level theme store driving `useSyncExternalStore`. Using an external
 * store (rather than useState + an effect that reads storage) keeps the read
 * off the render path and avoids the set-state-in-effect anti-pattern — the
 * same reason the reduced-motion hook is written this way.
 */
let state: ThemeState = SERVER_STATE;
const listeners = new Set<() => void>();

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref !== "system") return pref;
  return window.matchMedia(MEDIA_QUERY).matches ? "light" : "dark";
}

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** A stored palette must exist in the catalog AND belong to the mode it was
 * stored under — anything else falls back to the mode default. */
function readPalette(mode: PaletteMode): string {
  const stored = localStorage.getItem(PALETTE_STORAGE_KEYS[mode]);
  return stored && isPaletteForMode(stored, mode) ? stored : DEFAULT_PALETTES[mode];
}

function readState(): ThemeState {
  const pref = readPreference();
  return {
    theme: pref,
    resolvedTheme: resolve(pref),
    palettes: { dark: readPalette("dark"), light: readPalette("light") },
  };
}

function commit(next: ThemeState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  // Sync from storage whenever a consumer mounts (this also gives each test a
  // clean read after localStorage is reset).
  commit(readState());
  listeners.add(listener);
  const media = window.matchMedia(MEDIA_QUERY);
  const onMedia = () => {
    if (state.theme === "system") commit({ ...state, resolvedTheme: resolve("system") });
  };
  media.addEventListener("change", onMedia);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onMedia);
  };
}

const getSnapshot = (): ThemeState => state;
const getServerSnapshot = (): ThemeState => SERVER_STATE;

function setThemePreference(pref: ThemePreference): void {
  if (pref === "system") localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, pref);
  commit({ ...state, theme: pref, resolvedTheme: resolve(pref) });
}

function setPalettePreference(mode: PaletteMode, palette: string): void {
  if (!isPaletteForMode(palette, mode)) return;
  if (palette === DEFAULT_PALETTES[mode]) localStorage.removeItem(PALETTE_STORAGE_KEYS[mode]);
  else localStorage.setItem(PALETTE_STORAGE_KEYS[mode], palette);
  commit({ ...state, palettes: { ...state.palettes, [mode]: palette } });
}

/**
 * Owns the theme and keeps the document's `data-theme` (resolved mode) and
 * `data-palette` (the mode's chosen palette) in sync. Reads come from the
 * external store; the only effect writes to the DOM (an external-system sync,
 * not a state update).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme, resolvedTheme, palettes } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const activePalette = palettes[resolvedTheme];

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.palette = activePalette;
  }, [resolvedTheme, activePalette]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      palettes,
      setTheme: setThemePreference,
      toggleTheme: () => setThemePreference(resolvedTheme === "dark" ? "light" : "dark"),
      setPalette: setPalettePreference,
    }),
    [theme, resolvedTheme, palettes],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the current theme and controls. Must be used within ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
