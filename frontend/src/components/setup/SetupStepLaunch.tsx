"use client";

import { useEffect, useRef } from "react";

import { SetupNotice } from "@/components/setup/SetupNotice";
import { SetupStepShell } from "@/components/setup/SetupStepShell";
import { Button } from "@/components/ui/button";
import { PulseWire } from "@/components/ui/pulse-wire";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

import type { SetupWizardApi } from "@/components/setup/hooks/use-setup-wizard";

/** The console's route-change fade (motion doctrine: 120ms, no travel). */
const FADE_MS = 120;

/**
 * The terminal wizard step: no controls, it just runs the bootstrap.
 *
 * `bootstrapSetup` is one atomic backend call with no per-stage progress, so
 * this shows a single pulse rather than a staged checklist — a scripted
 * "index → pipelines → tools" sequence would be motion pretending to be
 * status, and it would drift silently from what bootstrap actually does.
 *
 * Failure is not a dead end: because the step fires on its own, an error must
 * offer both Retry and a way back to the collection step, or a failed
 * bootstrap strands the user on a step with nothing to press.
 */
export function StepLaunch({ wizard }: { wizard: SetupWizardApi }) {
  const { collectionName, indexName, backend } = wizard.state.choices;
  const reducedMotion = usePrefersReducedMotion();
  const started = useRef(false);
  const { finish, openCollection, completedCollectionId, error, warning } = wizard;

  // Fire once. A ref rather than a dependency guard because StrictMode
  // double-mounts in development and `finish` creates a real collection.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void finish();
  }, [finish]);

  // A clean run leaves on its own; warnings wait for acknowledgement so the
  // user actually reads them before the wizard disappears.
  const settled = completedCollectionId != null && !warning;
  // Derived, not stored: writing this into state from the same effect that
  // schedules the navigation costs a render and can only disagree with itself.
  const leaving = settled && !reducedMotion;

  useEffect(() => {
    if (!settled) return;
    if (reducedMotion) {
      openCollection();
      return;
    }
    const timer = setTimeout(openCollection, FADE_MS);
    return () => clearTimeout(timer);
  }, [settled, reducedMotion, openCollection]);

  const retry = () => {
    started.current = true;
    wizard.clearError();
    void finish();
  };

  return (
    <div
      className={cn(
        "transition-opacity duration-120 ease-accel motion-reduce:transition-none",
        leaving ? "opacity-0" : "opacity-100",
      )}
    >
      <SetupStepShell
        stepKey="launch"
        direction={wizard.state.direction}
        kicker="First-run setup"
        title="Launching"
        footer={
          error ? (
            <>
              <Button variant="ghost" onClick={wizard.back}>
                Back
              </Button>
              <Button size="lg" glow loading={wizard.busy} onClick={retry}>
                Try again
              </Button>
            </>
          ) : warning ? (
            <Button size="lg" glow className="ml-auto" onClick={openCollection}>
              Open {collectionName}
            </Button>
          ) : null
        }
      >
        <p className="max-w-[66ch] text-ui text-body">
          Installing the default ingestion pipeline and search tool for{" "}
          <span className="font-mono text-primary">{collectionName}</span> on{" "}
          <span className="font-mono text-primary">{indexName}</span> ({backend}).
        </p>
        {wizard.busy ? <PulseWire label="Installing pipelines" className="w-full" /> : null}
        <SetupNotice message={warning} tone="warning" />
        <SetupNotice message={error} />
      </SetupStepShell>
    </div>
  );
}
