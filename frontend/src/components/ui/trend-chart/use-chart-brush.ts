"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/** A half-open selection over bucket indices, in draw order. */
export type BucketSelection = { from: number; to: number };

export type ChartBrushSpan = { start: string; end: string };

type UseChartBrushOptions = {
  /** Bucket start timestamps, oldest first. */
  buckets: string[];
  /** Bucket width, used to turn the last selected bucket into an exclusive end. */
  bucketSeconds: number;
  /** Called with the selected span when a drag or keyboard selection commits. */
  onBrush?: (span: ChartBrushSpan) => void;
  /** Called when the user clears the selection (Escape, or a zero-width drag). */
  onResetBrush?: () => void;
};

/**
 * Pointer and keyboard selection over a bucketed chart.
 *
 * The keyboard path is not an add-on: brushing is the only control for the
 * chart's domain, so a pointer-only implementation would put the feature out of
 * reach entirely. Arrows move a cursor, Shift+arrows extend a selection, Enter
 * commits it, Escape clears.
 */
export function useChartBrush({
  buckets,
  bucketSeconds,
  onBrush,
  onResetBrush,
}: UseChartBrushOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const lastIndex = buckets.length - 1;
  const clamp = useCallback(
    (index: number) => Math.min(lastIndex, Math.max(0, index)),
    [lastIndex],
  );

  const indexAt = useCallback(
    (clientX: number): number | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || buckets.length === 0) return null;
      return clamp(Math.round(((clientX - rect.left) / rect.width) * lastIndex));
    },
    [buckets.length, clamp, lastIndex],
  );

  const selection = useMemo<BucketSelection | null>(() => {
    if (anchor === null || cursor === null || anchor === cursor) return null;
    return { from: Math.min(anchor, cursor), to: Math.max(anchor, cursor) };
  }, [anchor, cursor]);

  const commit = useCallback(
    (range: BucketSelection | null) => {
      if (!range || !onBrush) return;
      const start = buckets[range.from];
      const lastStart = buckets[range.to];
      if (!start || !lastStart) return;
      // The end is exclusive: a selection through bucket N covers all of N.
      const end = new Date(new Date(lastStart).getTime() + bucketSeconds * 1000).toISOString();
      onBrush({ start, end });
      setAnchor(null);
    },
    [buckets, bucketSeconds, onBrush],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || buckets.length < 2) return;
      const index = indexAt(event.clientX);
      if (index === null) return;
      setAnchor(index);
      setCursor(index);
      setDragging(true);
    },
    [buckets.length, indexAt],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const index = indexAt(event.clientX);
      if (index === null) return;
      setCursor(index);
    },
    [indexAt],
  );

  const endDrag = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    if (selection) commit(selection);
    else setAnchor(null);
  }, [commit, dragging, selection]);

  const onPointerLeave = useCallback(() => {
    endDrag();
    setCursor(null);
  }, [endDrag]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (buckets.length === 0) return;
      const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (step !== 0) {
        event.preventDefault();
        const next = clamp((cursor ?? (step > 0 ? -1 : lastIndex + 1)) + step);
        setCursor(next);
        if (event.shiftKey) setAnchor((current) => current ?? cursor ?? next);
        else setAnchor(null);
        return;
      }
      if (event.key === "Enter" && selection) {
        event.preventDefault();
        commit(selection);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setAnchor(null);
        setCursor(null);
        onResetBrush?.();
      }
    },
    [buckets.length, clamp, commit, cursor, lastIndex, onResetBrush, selection],
  );

  return {
    containerRef,
    cursor,
    selection,
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerLeave,
      onKeyDown,
      onBlur: () => setCursor(null),
    },
  };
}
