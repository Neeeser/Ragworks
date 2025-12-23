"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
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
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-10 backdrop-blur-sm"
      role="presentation"
      onClick={onCancel}
    >
      <GlassCard
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-slate-950/90 p-6 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Confirm action</p>
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          {description ? (
            <p className="text-sm leading-relaxed text-slate-300">{description}</p>
          ) : null}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            loading={loading}
            className={cn(
              confirmVariant === "danger" &&
                "bg-rose-500 text-white shadow-lg shadow-rose-500/30 hover:bg-rose-400",
            )}
          >
            {confirmLabel}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
