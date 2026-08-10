"use client";

import { CustomSelect } from "@/components/ui/custom-select";
import { inputClass } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

import { GROUP_BY_LABELS } from "./lib/labels";
import { RANGE_PRESETS } from "./lib/range";

import type { UsageRangeState } from "./lib/range";
import type { SegmentedOption } from "@/components/ui/segmented-control";
import type { UsageGroupBy } from "@/lib/types";

type RangeChoice = (typeof RANGE_PRESETS)[number] | "custom";

const RANGE_OPTIONS: Array<SegmentedOption<RangeChoice>> = [
  ...RANGE_PRESETS.map((preset) => ({ id: preset, label: preset })),
  { id: "custom" as const, label: "Custom" },
];

/** Which dimensions a scope can group by — `user` only spans accounts. */
export function groupByOptions(includeUser: boolean): UsageGroupBy[] {
  const dimensions: UsageGroupBy[] = ["model", "kind", "surface", "connection"];
  return includeUser ? [...dimensions, "user"] : dimensions;
}

type RangePickerProps = {
  range: UsageRangeState;
  onChange: (range: UsageRangeState) => void;
  invalid: boolean;
};

/** The range strip: three presets plus a custom pair of local dates. */
export function UsageRangePicker({ range, onChange, invalid }: RangePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        aria-label="Time range"
        options={RANGE_OPTIONS}
        value={range.preset}
        onChange={(preset) => onChange({ ...range, preset })}
      />
      {/* Native date inputs on purpose: the platform's own calendar and its
          keyboard entry are what a date field needs, and no themed popup here
          would carry the locale handling or the mobile picker. */}
      {range.preset === "custom" ? (
        <div className="flex items-center gap-1">
          <input
            type="date"
            aria-label="Range start"
            value={range.customStart}
            max={range.customEnd || undefined}
            onChange={(event) => onChange({ ...range, customStart: event.target.value })}
            className={cn(inputClass, "w-[9.5rem] py-1", invalid && "border-data-neg")}
          />
          <span className="text-instrument text-meta">to</span>
          <input
            type="date"
            aria-label="Range end"
            value={range.customEnd}
            min={range.customStart || undefined}
            onChange={(event) => onChange({ ...range, customEnd: event.target.value })}
            className={cn(inputClass, "w-[9.5rem] py-1", invalid && "border-data-neg")}
          />
        </div>
      ) : null}
    </div>
  );
}

type GroupByPickerProps = {
  value: UsageGroupBy;
  options: UsageGroupBy[];
  onChange: (value: UsageGroupBy) => void;
};

export function UsageGroupByPicker({ value, options, onChange }: GroupByPickerProps) {
  return (
    <CustomSelect
      aria-label="Group by"
      value={value}
      placeholder="Group by"
      className="w-40 py-1"
      options={options.map((option) => ({ value: option, label: GROUP_BY_LABELS[option] }))}
      onValueChange={(next) => onChange(next as UsageGroupBy)}
    />
  );
}

type UserPickerProps = {
  value: string | null;
  users: Array<{ id: string; email: string }>;
  disabled: boolean;
  onChange: (value: string | null) => void;
};

const ALL_USERS = "all";

/** The admin range's account filter. "All users" is a value, not an empty
 * selection, so the control never renders blank over a live filter. */
export function UsageUserPicker({ value, users, disabled, onChange }: UserPickerProps) {
  return (
    <CustomSelect
      aria-label="User"
      value={value ?? ALL_USERS}
      placeholder="All users"
      disabled={disabled}
      className="w-56 py-1"
      options={[
        { value: ALL_USERS, label: "All users" },
        ...users.map((user) => ({ value: user.id, label: user.email })),
      ]}
      onValueChange={(next) => onChange(next === ALL_USERS ? null : next)}
    />
  );
}
