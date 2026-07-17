"use client";

import { ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";

export type SortDirection = "asc" | "desc";

type SortControlOption = {
  value: string;
  label: string;
};

type SortControlProps = {
  label: string;
  value: string;
  direction: SortDirection;
  options: SortControlOption[];
  onValueChange: (value: string) => void;
  onDirectionChange: (direction: SortDirection) => void;
};

/** Controlled field selector and direction toggle for sortable views. */
export function SortControl({
  label,
  value,
  direction,
  options,
  onValueChange,
  onDirectionChange,
}: SortControlProps) {
  const nextDirection = direction === "asc" ? "desc" : "asc";
  const DirectionIcon = direction === "asc" ? ArrowUpNarrowWide : ArrowDownNarrowWide;

  return (
    <div className="flex items-center gap-2">
      <CustomSelect
        aria-label={label}
        value={value}
        options={options}
        placeholder={label}
        className="h-9 min-w-40 py-2"
        onValueChange={onValueChange}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-9 w-9 p-0"
        aria-label={`Sort ${nextDirection === "asc" ? "ascending" : "descending"}`}
        onClick={() => onDirectionChange(nextDirection)}
      >
        <DirectionIcon className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
