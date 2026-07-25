import { PALETTE_STORAGE_KEYS } from "@/lib/palettes";

/**
 * The pre-paint theme resolver, injected as a blocking inline script at the top
 * of <body> so it runs before the page renders — this is what prevents a flash
 * of the wrong theme and the hydration mismatch the AGENTS rule warns about
 * (React reads the DOM attributes this sets rather than reading storage itself).
 *
 * It stamps two attributes: `data-theme` is the resolved structural mode
 * (light/dark — what the logo swap and mode-scoped CSS key on), and
 * `data-palette` is the stored palette for that mode, if any. A stale or
 * hand-edited palette name simply matches no CSS block and falls back to the
 * mode's default values; the theme provider re-validates against the catalog
 * on hydration.
 *
 * Kept as a stringified IIFE (not a real function) because it must execute in
 * the document, not the React runtime. Storage keys mirror THEME_STORAGE_KEY
 * and PALETTE_STORAGE_KEYS.
 */
export const THEME_STORAGE_KEY = "ragworks-theme";

export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var s=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";var m=(t==="light"||t==="dark")?t:s;var d=document.documentElement;d.dataset.theme=m;var p=localStorage.getItem(m==="dark"?"${PALETTE_STORAGE_KEYS.dark}":"${PALETTE_STORAGE_KEYS.light}");if(p){d.dataset.palette=p;}}catch(e){document.documentElement.dataset.theme="dark";}})();`;
