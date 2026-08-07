"use client";

import { X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";

import { DraftRunTrace } from "./DraftRunTrace";
import { NodeValidationMessages } from "./NodeValidationMessages";

import type { UseDraftRunResult } from "./hooks/use-draft-run";
import type { NodeSpec, PipelineValidationIssue } from "@/lib/types";

type RunPanelOverlayProps = {
  run: UseDraftRunResult;
  nodeSpecs: NodeSpec[];
  onClose: () => void;
};

/** The run's own geometry while it executes — the same two panes, no content. */
function RunSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="shrink-0 space-y-2 border-b border-hairline bg-surface p-3 lg:w-80 lg:border-b-0 lg:border-r">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-8 rounded-control" />
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-3 p-3">
        <Skeleton className="h-4 max-w-56" />
        <Skeleton className="h-40 rounded-panel" />
      </div>
      <span className="sr-only">Running the draft</span>
    </div>
  );
}

/**
 * What the panel says when the run did not happen: the refusal's own sentence
 * and its findings as one list, then the issues that add node attribution.
 *
 * A refused draft and a failed request share the message list — both mean the
 * run did not happen, and the reason is the whole message either way. `issues`
 * restates `errors`, and this list has no field to attribute them to, so a
 * finding carried by both would render twice.
 */
function refusalContent(run: UseDraftRunResult): {
  messages: string[];
  issues: PipelineValidationIssue[];
} {
  if (!run.invalid) return { messages: run.error ? [run.error] : [], issues: [] };
  const messages = [run.invalid.message, ...run.invalid.errors];
  return {
    messages,
    issues: run.invalid.issues.filter((issue) => !messages.includes(issue.message)),
  };
}

/**
 * Run the draft graph over the canvas it was drawn on.
 *
 * Testing a retrieval change is edit-test-edit, so this opens above the
 * editor rather than navigating to a collection's Search tab: a route change
 * there costs the user their unsaved graph and their place. It runs the graph
 * as it stands, never the last saved version, so what runs is what is on
 * screen.
 */
export function RunPanelOverlay({ run, nodeSpecs, onClose }: RunPanelOverlayProps) {
  const titleId = useId();
  const queryId = useId();
  const collectionId = useId();
  const canRun = Boolean(run.query.trim()) && Boolean(run.collectionId) && !run.running;
  const refusal = refusalContent(run);

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId}>
      <div className="card-surface flex h-[92vh] w-[94vw] flex-col bg-canvas-raised shadow-elevation-2">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 py-2">
          <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
            Run pipeline
          </h2>
          <Tooltip content="Close">
            <button
              type="button"
              aria-label="Close run panel"
              onClick={onClose}
              className="rounded-chip p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        </div>

        <form
          className="flex shrink-0 flex-wrap items-end gap-2 border-b border-hairline p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run.run();
          }}
        >
          <Field label="Sample query" className="min-w-60 flex-1">
            <TextInput
              id={queryId}
              value={run.query}
              placeholder="Ask the pipeline something"
              onChange={(event) => run.setQuery(event.target.value)}
            />
          </Field>
          <Field label="Collection" className="w-56">
            <CustomSelect
              id={collectionId}
              value={run.collectionId ?? ""}
              placeholder="Pick a collection"
              options={run.collections.map((collection) => ({
                value: collection.id,
                label: collection.name,
              }))}
              onValueChange={run.setCollectionId}
            />
          </Field>
          <Button type="submit" glow={canRun} disabled={!canRun} loading={run.running}>
            Run
          </Button>
        </form>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {refusal.messages.length > 0 ? (
            <div className="space-y-2 p-3">
              <NodeValidationMessages
                errors={refusal.messages}
                issues={refusal.issues}
                includeFieldIssues
              />
            </div>
          ) : null}
          {run.running ? <RunSkeleton /> : null}
          {!run.running && run.result ? (
            <>
              {run.result.failure ? (
                <p
                  role="alert"
                  className="shrink-0 border-b border-data-neg/30 bg-data-neg/10 px-3 py-2 text-ui text-data-neg"
                >
                  {run.result.failure.message}
                </p>
              ) : null}
              <DraftRunTrace trace={run.result.trace} nodeSpecs={nodeSpecs} />
            </>
          ) : null}
          {!run.running && !run.result && refusal.messages.length === 0 ? (
            <p className="p-8 text-center text-ui text-muted">
              Run a sample query to see what each node received, produced, and how long it took.
            </p>
          ) : null}
        </div>
      </div>
    </ModalOverlay>
  );
}
