"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef } from "react";

import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import type { AriaAttributes } from "react";

export type CustomSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  preventFocusRestore?: boolean;
};

type CustomSelectProps = Pick<
  AriaAttributes,
  "aria-describedby" | "aria-invalid" | "aria-label" | "aria-labelledby"
> & {
  id?: string;
  value: string;
  options: CustomSelectOption[];
  placeholder: string;
  disabled?: boolean;
  className?: string;
  onValueChange: (value: string) => void;
};

const scrollButtonClass =
  "flex h-7 cursor-default items-center justify-center bg-canvas-raised text-muted";
const ITEM_VALUE_PREFIX = "ragworks-select:";

const encodeValue = (value: string) => `${ITEM_VALUE_PREFIX}${value}`;
const decodeValue = (value: string) => value.slice(ITEM_VALUE_PREFIX.length);

export const CustomSelect = forwardRef<HTMLButtonElement, CustomSelectProps>(function CustomSelect(
  { id, value, options, placeholder, disabled, className, onValueChange, ...ariaProps },
  ref,
) {
  const preventFocusRestoreRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);

  const handleValueChange = (nextValue: string) => {
    const decodedValue = decodeValue(nextValue);
    preventFocusRestoreRef.current =
      options.find((option) => option.value === decodedValue)?.preventFocusRestore ?? false;
    onValueChange(decodedValue);
  };

  return (
    <SelectPrimitive.Root
      value={value ? encodeValue(value) : ""}
      disabled={disabled}
      onValueChange={handleValueChange}
    >
      <SelectPrimitive.Trigger
        ref={triggerRef}
        id={id}
        className={cn(
          inputClass,
          "flex items-center justify-between gap-3 text-left data-[placeholder]:text-meta",
          "focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:cursor-not-allowed disabled:text-faint disabled:opacity-60 motion-reduce:transition-none",
          className,
        )}
        {...ariaProps}
      >
        <SelectPrimitive.Value className="truncate" placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (preventFocusRestoreRef.current) {
              preventFocusRestoreRef.current = false;
              return;
            }
            triggerRef.current?.focus();
          }}
          className={cn(
            "relative z-[70] max-h-[min(20rem,var(--radix-select-content-available-height))]",
            "min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-2xl",
            "border border-hairline bg-canvas-raised p-1 shadow-elevation-2",
          )}
        >
          <SelectPrimitive.ScrollUpButton className={scrollButtonClass}>
            <ChevronUp className="h-4 w-4" aria-hidden />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={encodeValue(option.value)}
                textValue={option.label}
                disabled={option.disabled}
                className={cn(
                  "relative flex cursor-default select-none items-center rounded-xl py-2 pl-9 pr-3 text-sm text-body outline-none",
                  "data-[highlighted]:bg-surface-strong data-[highlighted]:text-primary",
                  "data-[state=checked]:text-primary data-[disabled]:text-faint",
                  "data-[disabled]:pointer-events-none motion-reduce:transition-none",
                )}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-3 inline-flex items-center text-accent-violet">
                  <Check className="h-4 w-4" aria-hidden />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className={scrollButtonClass}>
            <ChevronDown className="h-4 w-4" aria-hidden />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});
