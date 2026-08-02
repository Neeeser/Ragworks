"use client";

import { useEffect, useState } from "react";

import { VIEW_H, VIEW_W } from "./scales";

import type { RefObject } from "react";

export type PlotScale = {
  /** User units per rendered pixel, horizontally and vertically. */
  sx: number;
  sy: number;
};

const UNSCALED: PlotScale = { sx: 1, sy: 1 };

/**
 * How far the fixed viewBox is stretched to fill its container.
 *
 * The plot renders with `preserveAspectRatio="none"`, so the two axes scale by
 * different factors — a 600×160 viewBox in a 1200×128 box stretches 2x across
 * and 0.8x down. Anything meant to be round has to be drawn against that:
 * a plain `<circle r=4>` comes out as a flat oval, and a chart of measurements
 * that renders them as lozenges reads as a rendering fault rather than data.
 */
export function usePlotScale(ref: RefObject<HTMLElement | null>, height: number): PlotScale {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);

  if (width <= 0 || height <= 0) return UNSCALED;
  return { sx: width / VIEW_W, sy: height / VIEW_H };
}

/**
 * The user-space radii that render as a circle of `radius` pixels.
 *
 * Kept as a pair rather than one number because the two axes stretch
 * independently; collapsing them to an average brings the oval back.
 */
export function circleRadii(radius: number, scale: PlotScale): { rx: number; ry: number } {
  return { rx: radius / scale.sx, ry: radius / scale.sy };
}
