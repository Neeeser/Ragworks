"use client";

import { CustomSelect } from "@/components/ui/custom-select";
import { inputClass } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
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
};

/**
 * The preset strip alone — this is what sits in the top bar.
 *
 * The two date fields live in `UsageCustomRange`, in the page body: three
 * presets plus two 152px date inputs plus the breadcrumb do not fit a 375px
 * top bar, and the bar's action slot cannot shrink its contents.
 */
export function UsageRangePicker({ range, onChange }: RangePickerProps) {
  return (
    <SegmentedControl
      aria-label="Time range"
      options={RANGE_OPTIONS}
      value={range.preset}
      onChange={(preset) => onChange({ ...range, preset })}
    />
  );
}

type CustomRangeProps = RangePickerProps & { invalid: boolean };

/** The custom range's two local days, shown only once Custom is chosen. */
export function UsageCustomRange({ range, onChange, invalid }: CustomRangeProps) {
  // Native date inputs on purpose: the platform's own calendar and its keyboard
  // entry are what a date field needs, and no themed popup here would carry the
  // locale handling or the mobile picker.
  const field = cn(inputClass, "w-full py-1 sm:w-[9.5rem]", invalid && "border-data-neg");
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-instrument text-muted">From</span>
        <input
          type="date"
          aria-label="Range start"
          value={range.customStart}
          max={range.customEnd || undefined}
          onChange={(event) => onChange({ ...range, customStart: event.target.value })}
          className={field}
        />
      </label>
      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-instrument text-muted">To</span>
        <input
          type="date"
          aria-label="Range end"
          value={range.customEnd}
          min={range.customStart || undefined}
          onChange={(event) => onChange({ ...range, customEnd: event.target.value })}
          className={field}
        />
      </label>
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

type GroupingBarProps = {
  admin: boolean;
  groupBy: UsageGroupBy;
  onGroupByChange: (value: UsageGroupBy) => void;
  userId: string | null;
  users: Array<{ id: string; email: string }>;
  usersError: string | null;
  onUserChange: (value: string | null) => void;
};

/** The row above the breakdown table: what it is grouped by, and — for the
 * admin ledger — whose rows it covers. */
export function UsageGroupingBar({
  admin,
  groupBy,
  onGroupByChange,
  userId,
  users,
  usersError,
  onUserChange,
}: GroupingBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <InstrumentLabel>Group by</InstrumentLabel>
      <UsageGroupByPicker
        value={groupBy}
        options={groupByOptions(admin)}
        onChange={onGroupByChange}
      />
      {admin ? (
        <UsageUserPicker
          value={userId}
          users={users}
          disabled={groupBy === "user"}
          onChange={onUserChange}
        />
      ) : null}
      {/* A failed account list leaves the filter offering "All users" alone,
          which looks like a deployment with one account. */}
      {usersError ? (
        <span role="alert" className="text-instrument text-data-neg">
          {`Accounts could not be listed: ${usersError}`}
        </span>
      ) : null}
    </div>
  );
}
