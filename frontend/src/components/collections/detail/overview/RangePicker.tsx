"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";

import type { SegmentedOption } from "@/components/ui/segmented-control";
import type { StatsHistoryRange } from "@/lib/types";

const RANGES: Array<SegmentedOption<StatsHistoryRange>> = [
  { id: "4h", label: "4h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

type RangePickerProps = {
  value: StatsHistoryRange;
  onChange: (range: StatsHistoryRange) => void;
};

/** Page-level trailing-window selector; every overview chart follows it. */
export function RangePicker({ value, onChange }: RangePickerProps) {
  return (
    <SegmentedControl aria-label="Time range" options={RANGES} value={value} onChange={onChange} />
  );
}
