"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSetupWizard } from "@/components/setup/hooks/use-setup-wizard";
import { SETUP_STEPS } from "@/components/setup/lib/setup-wizard-reducer";
import { SetupFlowBackdrop } from "@/components/setup/SetupFlowBackdrop";
import { StepModel, StepProviders, StepWelcome } from "@/components/setup/SetupSteps";
import { StepIndex, StepLaunch } from "@/components/setup/SetupStepsLaunch";
import { cn } from "@/lib/utils";
import { useSetupStatus } from "@/providers/setup-status-provider";

/** Full-bleed first-run wizard: one step at a time over a faint live pipeline. */
export function SetupWizard() {
  const wizard = useSetupWizard();
  const { status } = useSetupStatus();
  const router = useRouter();
  const activeIndex = SETUP_STEPS.indexOf(wizard.state.step);

  // An already-set-up user landing on /setup goes home. Only from the
  // welcome step: once a run is underway (or just finished, which flips
  // status optimistically), the wizard owns navigation.
  useEffect(() => {
    if (status?.setup_complete && wizard.state.step === "welcome") {
      router.replace("/dashboard");
    }
  }, [status, wizard.state.step, router]);

  return (
    <div className="relative flex min-h-[calc(100vh-6rem)] flex-col items-center justify-center overflow-hidden">
      <SetupFlowBackdrop step={wizard.state.step} />
      <div className="relative z-10 flex w-full max-w-xl flex-col px-4">
        <nav aria-label="Setup progress" className="mb-6 flex items-center gap-2">
          {SETUP_STEPS.map((step, index) => (
            <span
              key={step}
              aria-hidden
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                index === activeIndex
                  ? "w-8 bg-accent-violet"
                  : index < activeIndex
                    ? "w-3 bg-accent-violet/50"
                    : "w-3 bg-surface-strong",
              )}
            />
          ))}
          <span className="sr-only">
            Step {activeIndex + 1} of {SETUP_STEPS.length}
          </span>
        </nav>
        {wizard.state.step === "welcome" ? <StepWelcome wizard={wizard} /> : null}
        {wizard.state.step === "providers" ? <StepProviders wizard={wizard} /> : null}
        {wizard.state.step === "model" ? <StepModel wizard={wizard} /> : null}
        {wizard.state.step === "index" ? <StepIndex wizard={wizard} /> : null}
        {wizard.state.step === "launch" ? <StepLaunch wizard={wizard} /> : null}
      </div>
    </div>
  );
}
