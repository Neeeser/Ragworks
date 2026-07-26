"use client";

import { CustomSelect } from "@/components/ui/custom-select";
import { TextInput } from "@/components/ui/field";
import { ParameterLabel, parameterAccessibleName } from "@/components/ui/parameter-label";
import { Tooltip } from "@/components/ui/tooltip";

import type { QueryArgumentValues } from "./use-collection-search";
import type { CollectionQueryArgument } from "@/lib/types";

type QueryArgumentControlsProps = {
  argumentsSpec: CollectionQueryArgument[];
  values: QueryArgumentValues;
  onChange: (name: string, value: number | string | boolean | undefined) => void;
};

/**
 * One typed control per declared pipeline argument, rendered inline beside
 * the query composer's other controls.
 */
export function QueryArgumentControls({
  argumentsSpec,
  values,
  onChange,
}: QueryArgumentControlsProps) {
  return (
    <>
      {argumentsSpec.map((argument) => (
        // The description explains a control that cannot explain itself, so it
        // goes through `Tooltip` — a `title` attribute cannot be themed and
        // ignores the motion system.
        <Tooltip key={argument.name} content={argument.description ?? ""} side="bottom">
          <span className="flex items-center gap-2">
            <ParameterLabel name={argument.name} />
            <ArgumentControl
              argument={argument}
              value={values[argument.name]}
              onChange={onChange}
            />
          </span>
        </Tooltip>
      ))}
    </>
  );
}

function ArgumentControl({
  argument,
  value,
  onChange,
}: {
  argument: CollectionQueryArgument;
  value: number | string | boolean | undefined;
  onChange: (name: string, value: number | string | boolean | undefined) => void;
}) {
  const ariaLabel = parameterAccessibleName(argument.name);
  if (argument.type === "boolean") {
    return (
      <CustomSelect
        aria-label={ariaLabel}
        value={value === true ? "true" : value === false ? "false" : ""}
        placeholder="—"
        className="w-28 px-2 py-1"
        options={[
          { value: "", label: "No value" },
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
        onValueChange={(next) => onChange(argument.name, next === "" ? undefined : next === "true")}
      />
    );
  }
  if (argument.type === "enum") {
    return (
      <CustomSelect
        aria-label={ariaLabel}
        value={typeof value === "string" ? value : ""}
        placeholder="—"
        className="w-36 px-2 py-1"
        options={argument.choices.map((choice) => ({ value: choice, label: choice }))}
        onValueChange={(next) => onChange(argument.name, next)}
      />
    );
  }
  if (argument.type === "integer" || argument.type === "number") {
    return (
      <TextInput
        type="number"
        aria-label={ariaLabel}
        min={argument.minimum ?? undefined}
        max={argument.maximum ?? undefined}
        step={argument.type === "integer" ? 1 : undefined}
        value={typeof value === "number" ? value : ""}
        className="w-20 px-2 py-1 text-center font-mono tabular-nums"
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange(argument.name, undefined);
            return;
          }
          const parsed = Number(raw);
          if (Number.isNaN(parsed)) return;
          onChange(argument.name, argument.type === "integer" ? Math.trunc(parsed) : parsed);
        }}
      />
    );
  }
  return (
    <TextInput
      aria-label={ariaLabel}
      value={typeof value === "string" ? value : ""}
      className="w-40 px-2 py-1"
      onChange={(event) => onChange(argument.name, event.target.value)}
    />
  );
}
