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

  // The shell gives this route a fixed-height column and the backdrop is
  // full-bleed, so the step column owns the scroll: without it, a step that
  // outgrows the viewport (five connections on the providers step) put its
  // Continue button below the fold with no scrollable ancestor to reach it.
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden">
      <SetupFlowBackdrop step={wizard.state.step} />
      <div className="relative z-10 flex max-h-full w-full max-w-xl flex-col overflow-y-auto px-4 py-4">
        {/* Progress as a node path: square node dots, the current one stretched
            into a wire segment — the console's own mark, not a pill row. */}
        <nav aria-label="Setup progress" className="mb-3 flex items-center gap-1">
          {SETUP_STEPS.map((step, index) => (
            <span
              key={step}
              aria-hidden
              className={cn(
                "h-1.5 rounded-[2px] transition-all duration-160 ease-decel motion-reduce:transition-none",
                index === activeIndex
                  ? "w-6 bg-accent-violet shadow-[0_0_8px] shadow-accent-violet/50"
                  : index < activeIndex
                    ? "w-1.5 bg-accent-violet/50"
                    : "w-1.5 bg-surface-strong",
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
