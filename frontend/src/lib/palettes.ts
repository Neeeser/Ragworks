/**
 * The palette catalog — the one list of selectable palettes, shared by the
 * pre-paint theme script, the theme provider, the settings picker, and the
 * palette contract test.
 *
 * A palette is a values-only diff in `globals.css`, keyed by
 * `:root[data-palette="<id>"]`; the two mode defaults (deep-space, paper) are
 * the `data-theme` base blocks themselves, so they need no override block.
 * Every palette resolves to one of two structural modes — the user picks one
 * palette per mode, and the resolved mode decides which applies.
 */

export type PaletteMode = "light" | "dark";

export interface PaletteDefinition {
  id: string;
  label: string;
  mode: PaletteMode;
  /** One-line fact shown beside the label in the picker. */
  hint: string;
  /**
   * Picker preview chips. These mirror the palette's own `--canvas` and
   * `--panel-from` values — the contract test pins them against globals.css so
   * the preview can't drift from what selecting the palette actually does.
   */
  swatch: { canvas: string; panel: string };
}

export const PALETTES: readonly PaletteDefinition[] = [
  {
    id: "deep-space",
    label: "Deep space",
    mode: "dark",
    hint: "Violet-cast dark (default)",
    swatch: { canvas: "#0a0910", panel: "#171420" },
  },
  {
    id: "midnight",
    label: "Midnight",
    mode: "dark",
    hint: "Indigo-cast dark",
    swatch: { canvas: "#070b16", panel: "#121a2e" },
  },
  {
    id: "graphite",
    label: "Graphite",
    mode: "dark",
    hint: "Lifted base, lower contrast",
    swatch: { canvas: "#15161d", panel: "#1e2029" },
  },
  {
    id: "true-black",
    label: "True black",
    mode: "dark",
    hint: "OLED black",
    swatch: { canvas: "#000000", panel: "#0e0d13" },
  },
  {
    id: "high-contrast",
    label: "High contrast",
    mode: "dark",
    hint: "AAA text, explicit structure",
    swatch: { canvas: "#000000", panel: "#121212" },
  },
  {
    id: "paper",
    label: "Paper",
    mode: "light",
    hint: "Cool light (default)",
    swatch: { canvas: "#f5f4f9", panel: "#ffffff" },
  },
  {
    id: "linen",
    label: "Linen",
    mode: "light",
    hint: "Warm light",
    swatch: { canvas: "#f6f3ee", panel: "#fffdf9" },
  },
];

/** The palette each mode falls back to when nothing is stored. */
export const DEFAULT_PALETTES: Record<PaletteMode, string> = {
  dark: "deep-space",
  light: "paper",
};

/** One storage key per mode, so switching modes never loses the other's pick. */
export const PALETTE_STORAGE_KEYS: Record<PaletteMode, string> = {
  dark: "ragworks-palette-dark",
  light: "ragworks-palette-light",
};

export function palettesForMode(mode: PaletteMode): PaletteDefinition[] {
  return PALETTES.filter((palette) => palette.mode === mode);
}

/** True when `id` names a palette of the given mode — the storage-read guard. */
export function isPaletteForMode(id: string, mode: PaletteMode): boolean {
  return PALETTES.some((palette) => palette.id === id && palette.mode === mode);
}
