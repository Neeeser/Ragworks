"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

type ModalOverlayProps = {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  children: ReactNode;
  backdropClassName?: string;
  closeOnBackdrop?: boolean;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Stack of currently-open overlays, in open order. Escape only dismisses the overlay
// at the top of the stack, so nested dialogs (e.g. a ConfirmDialog layered over
// another modal) close one layer per press, per the ARIA dialog convention.
const openOverlayStack: symbol[] = [];

export function ModalOverlay({
  open,
  onClose,
  labelledBy,
  children,
  backdropClassName,
  closeOnBackdrop = true,
}: ModalOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const stackIdRef = useRef(Symbol("modal-overlay"));
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const stackId = stackIdRef.current;
    openOverlayStack.push(stackId);

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    const autofocusEl = dialog?.querySelector<HTMLElement>("[autofocus]");
    const firstFocusable = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    const target = autofocusEl ?? firstFocusable ?? dialog;
    target?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        if (openOverlayStack[openOverlayStack.length - 1] !== stackId) return;
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const nodes = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      const stackIndex = openOverlayStack.indexOf(stackId);
      if (stackIndex !== -1) openOverlayStack.splice(stackIndex, 1);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 px-4 py-10 backdrop-blur-sm",
        backdropClassName,
      )}
      role="presentation"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="flex max-h-full w-full items-center justify-center outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
