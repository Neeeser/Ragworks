"use client";

import { useEffect, useState } from "react";

/**
 * Resolves CSS custom properties to their concrete computed values, re-reading
 * whenever the palette changes (the theme provider stamps `data-theme` and
 * `data-palette` on `<html>`).
 *
 * This is the ONE sanctioned place a colour is read with `getComputedStyle`:
 * it exists for canvas-rendering libraries (deck.gl, ReactFlow's SVG
 * `Background`) whose APIs take numeric channels or presentation attributes
 * where a `var()` reference is invalid. DOM styling never uses this — it uses
 * the tokens directly.
 *
 * `names` must be referentially stable (a module-level constant) — a fresh
 * array per render would re-subscribe the observer every time.
 *
 * Values start empty so the server render and first paint stay deterministic
 * (hydration-safe); the real values land in a mount effect.
 */
export function useCssTokens(names: readonly string[]): string[] {
  const [values, setValues] = useState<string[]>(() => names.map(() => ""));

  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const style = getComputedStyle(root);
      setValues(names.map((name) => style.getPropertyValue(name).trim()));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    return () => observer.disconnect();
  }, [names]);

  return values;
}
