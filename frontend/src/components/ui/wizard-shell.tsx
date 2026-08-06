"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { popoverSurfaceClass } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

export type WizardStep = {
  id: string;
  label: string;
  description: string;
};

type WizardShellProps = {
  open: boolean;
  title: string;
  subtitle: string;
  steps: WizardStep[];
  activeStepIndex: number;
  message?: string | null;
  /**
   * Highest step the user may jump to from the step list. Steps beyond it are
   * disabled, so a required field on an earlier step can't be walked past — the
   * Next button and the step list gate on the same rule instead of only Next.
   * Defaults to the last step (every step reachable).
   */
  maxReachableStepIndex?: number;
  onStepChange: (index: number) => void;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
};

type WizardFooterProps = {
  step: number;
  stepCount: number;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
};

export function WizardFooter({
  step,
  stepCount,
  onBack,
  onNext,
  nextLabel,
  nextDisabled = false,
  busy = false,
  onCancel,
  cancelLabel = "Cancel",
}: WizardFooterProps) {
  const isFinalStep = step >= stepCount - 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {onCancel ? (
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={onBack}
          disabled={busy || step === 0}
          className="flex items-center gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        {isFinalStep ? (
          <Button onClick={onNext} loading={busy} disabled={nextDisabled}>
            {nextLabel ?? "Create"}
          </Button>
        ) : (
          <Button
            onClick={onNext}
            disabled={busy || nextDisabled}
            className="flex items-center gap-2"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function WizardShell({
  open,
  title,
  subtitle,
  steps,
  activeStepIndex,
  message,
  maxReachableStepIndex,
  onStepChange,
  onClose,
  children,
  footer,
}: WizardShellProps) {
  const titleId = useId();
  const activeStep = steps[activeStepIndex];
  const lastReachable = maxReachableStepIndex ?? steps.length - 1;

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      {/* The dialog is capped to the viewport and only its step body scrolls, so
          a tall step keeps the header, step list, and footer controls on screen. */}
      <div
        className={cn(
          popoverSurfaceClass,
          "flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden text-primary",
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-hairline p-3">
          <div className="min-w-0">
            <InstrumentLabel>{title}</InstrumentLabel>
            <h2 id={titleId} className="text-head font-semibold">
              {subtitle}
            </h2>
            {/* One factual line about the step the user is on — it says something
                the step list does not already show. */}
            <p className="text-ui text-muted">{activeStep?.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-control border border-hairline p-1 text-muted transition-colors duration-80 ease-standard hover:border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            aria-label="Close wizard"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {message ? (
          <p className="shrink-0 border-b border-hairline bg-data-neg/10 p-3 text-ui text-data-neg">
            {message}
          </p>
        ) : null}

        {/* Both columns carry min-w-0: a grid item's automatic minimum size is
            its content's min-content width, so one non-wrapping row inside a
            step (a truncating model name) sizes the column past the dialog and
            the step body clips off the right edge instead of scrolling. */}
        <div className="grid min-h-0 flex-1 lg:grid-cols-[200px_1fr]">
          <div className="min-w-0 shrink-0 border-hairline p-2 lg:border-r">
            {steps.map((step, index) => {
              const isActive = index === activeStepIndex;
              const isComplete = index < activeStepIndex;
              const isReachable = index <= lastReachable;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => onStepChange(index)}
                  disabled={!isReachable}
                  className={cn(
                    "w-full rounded-control px-2 py-2 text-left transition-colors duration-80 ease-standard",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
                    isActive
                      ? "bg-accent-violet/15 text-primary ring-1 ring-inset ring-accent-violet/30"
                      : isReachable
                        ? "text-body hover:bg-surface"
                        : "cursor-not-allowed text-faint",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <InstrumentLabel className={isComplete ? "text-data-pos" : undefined}>
                      {index + 1}
                    </InstrumentLabel>
                    <span className="min-w-0 flex-1 truncate text-ui font-medium">
                      {step.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">{children}</div>
            <div className="shrink-0 border-t border-hairline p-3">{footer}</div>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
