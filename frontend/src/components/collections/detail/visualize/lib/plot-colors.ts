/**
 * Conversion from computed CSS colour values to the numeric RGBA channel
 * arrays deck.gl layers take. Pure, so the parsing is unit-testable without a
 * canvas.
 */

export type Rgba = [number, number, number, number];

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FUNC = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/**
 * Parses a computed token value (`#rrggbb`, `#rgb`, `rgb()`, `rgba()`) into
 * deck.gl channels. `alpha` (0–255) overrides the colour's own alpha when
 * given. Returns null for anything unparsable — including the empty string
 * jsdom and the first client render produce — so callers keep a literal
 * fallback instead of flashing black.
 */
export function cssColorToRgba(value: string, alpha?: number): Rgba | null {
  const trimmed = value.trim();
  const short = HEX_SHORT.exec(trimmed);
  if (short) {
    const [r, g, b] = [short[1], short[2], short[3]].map((c) => parseInt(c + c, 16));
    return [r, g, b, alpha ?? 255];
  }
  const long = HEX_LONG.exec(trimmed);
  if (long) {
    const [r, g, b] = [long[1], long[2], long[3]].map((c) => parseInt(c, 16));
    return [r, g, b, alpha ?? 255];
  }
  const func = RGB_FUNC.exec(trimmed);
  if (func) {
    const [r, g, b] = [func[1], func[2], func[3]].map((channel) =>
      Math.round(Math.min(255, Number(channel))),
    );
    const ownAlpha = func[4] === undefined ? 255 : Math.round(Math.min(1, Number(func[4])) * 255);
    return [r, g, b, alpha ?? ownAlpha];
  }
  return null;
}

/** The colour with its alpha channel replaced. */
export function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], alpha];
}

/**
 * The deck.gl hover box's look. The library renders its tooltip into its own
 * element, so the style travels inline; `var()` keeps it correct in every
 * palette. This is the plot's hover layer rather than the shared `Tooltip`
 * primitive because a point has no DOM node to anchor to and the box has to
 * follow the cursor across the canvas.
 */
export const CANVAS_TOOLTIP_STYLE = {
  background: "var(--canvas-raised)",
  border: "1px solid var(--border-hairline)",
  borderRadius: "6px",
  boxShadow: "var(--elevation-2)",
  color: "var(--text-primary)",
  fontSize: "11px",
  lineHeight: "1.45",
  maxWidth: "260px",
  padding: "4px 6px",
  whiteSpace: "pre-line",
};
