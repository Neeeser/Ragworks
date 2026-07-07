"use client";

import { cloneElement, forwardRef, isValidElement, useId } from "react";

import { cn } from "@/lib/utils";

import type {
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export const inputClass =
  "w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400";

const DESCRIBED_BY = "aria-describedby" as const;

type FieldProps = {
  label: ReactNode;
  labelEnd?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  labelClassName?: string;
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false";
  }>;
};

export function Field({
  label,
  labelEnd,
  hint,
  error,
  className,
  labelClassName,
  children,
}: FieldProps) {
  const generatedId = useId();
  const descriptionId = useId();
  const controlId = (isValidElement(children) && children.props.id) || generatedId;
  const description = error ?? hint;

  const control = cloneElement(children, {
    id: controlId,
    [DESCRIBED_BY]: description
      ? [children.props[DESCRIBED_BY], descriptionId].filter(Boolean).join(" ")
      : children.props[DESCRIBED_BY],
    "aria-invalid": error ? true : children.props["aria-invalid"],
  });

  const labelElement = (
    <label htmlFor={controlId} className={cn("block text-sm text-slate-300", labelClassName)}>
      {label}
    </label>
  );

  return (
    <div className={cn("space-y-2", className)}>
      {labelEnd ? (
        <div className="flex items-center justify-between gap-2">
          {labelElement}
          {labelEnd}
        </div>
      ) : (
        labelElement
      )}
      {control}
      {description ? (
        <p id={descriptionId} className={cn("text-xs", error ? "text-rose-300" : "text-slate-400")}>
          {description}
        </p>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputClass, className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(inputClass, className)} {...props} />;
  },
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputClass, className)} {...props} />;
});
