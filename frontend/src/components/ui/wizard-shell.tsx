"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { GlassCard } from "@/components/ui/panel";
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
        <Button variant="ghost" onClick={onCancel} disabled={busy} className="px-5">
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
  onStepChange,
  onClose,
  children,
  footer,
}: WizardShellProps) {
  const titleId = useId();
  const activeStep = steps[activeStepIndex];

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <GlassCard className="w-full max-w-5xl rounded-[2.5rem] border border-hairline bg-canvas-raised/95 p-6 text-primary">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">{title}</p>
            <h2 id={titleId} className="mt-2 text-2xl font-semibold">
              {subtitle}
            </h2>
            <p className="text-sm text-muted">{activeStep?.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-hairline p-2 text-muted transition hover:border-strong hover:text-primary"
            aria-label="Close wizard"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {message ? (
          <div className="mt-4 rounded-2xl border border-data-neg/30 bg-data-neg/10 p-3 text-sm text-data-neg">
            {message}
          </div>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
          <div className="space-y-3">
            {steps.map((step, index) => {
              const isActive = index === activeStepIndex;
              const isComplete = index < activeStepIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => onStepChange(index)}
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3 text-left transition",
                    isActive
                      ? "border-accent-violet bg-accent-violet/10 text-primary"
                      : "border-hairline bg-surface text-body hover:border-strong",
                  )}
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                    Step {index + 1}
                  </p>
                  <p className="text-base font-semibold">{step.label}</p>
                  <p className="text-xs text-muted">{isComplete ? "Complete" : "Pending"}</p>
                </button>
              );
            })}
          </div>

          <div className="space-y-6">
            {children}
            {footer}
          </div>
        </div>
      </GlassCard>
    </ModalOverlay>
  );
}
