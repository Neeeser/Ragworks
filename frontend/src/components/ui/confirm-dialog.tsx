"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  confirmText?: string;
  rememberLabel?: string;
  rememberChecked?: boolean;
  onRememberChange?: (checked: boolean) => void;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  confirmText,
  rememberLabel,
  rememberChecked = false,
  onRememberChange,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const [typedText, setTypedText] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);

  if (prevOpen !== open) {
    setPrevOpen(open);
    setTypedText("");
  }

  const confirmBlocked = Boolean(confirmText) && typedText !== confirmText;

  return (
    <ModalOverlay open={open} onClose={onCancel} labelledBy={titleId}>
      <div className="card-surface w-full max-w-lg bg-canvas-raised p-4 text-primary shadow-elevation-2">
        <div className="space-y-3">
          {/* No "Confirm action" eyebrow: the title says what is being confirmed;
              an eyebrow restating the dialog's nature is decorative text. */}
          <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
            {title}
          </h2>
          {description ? (
            <p className="max-w-[66ch] text-ui leading-relaxed text-body">{description}</p>
          ) : null}
          {confirmText ? (
            <Field
              label={
                <>
                  Type <span className="font-semibold text-primary">{confirmText}</span> to confirm
                </>
              }
            >
              <TextInput
                autoComplete="off"
                value={typedText}
                onChange={(event) => setTypedText(event.target.value)}
              />
            </Field>
          ) : null}
          {rememberLabel && onRememberChange ? (
            <label className="flex items-center gap-2 text-ui text-body">
              <input
                type="checkbox"
                className="h-4 w-4 rounded-chip border-strong bg-transparent accent-[var(--accent-violet)]"
                checked={rememberChecked}
                onChange={(event) => onRememberChange(event.target.checked)}
              />
              <span>{rememberLabel}</span>
            </label>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={onConfirm}
            loading={loading}
            disabled={confirmBlocked}
            className={cn(
              // The danger fill replaces the accent; the primary variant's inset
              // top-light stays correct over any fill colour.
              confirmVariant === "danger" && "bg-data-neg text-white hover:brightness-110",
            )}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
