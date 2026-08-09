import type { PipelineRunTrace } from "@/lib/types";

type TraceNoticesProps = {
  /** Degraded-rendering warning when node specs failed to load. */
  specsNotice: string | null;
  run: PipelineRunTrace;
};

/**
 * The banners above the trace: a specs-load warning, and the run's own
 * outcome — which no node carries: an unsupported file or a post-execution
 * failure leaves every node completed, so without the outcome line the
 * trace states a result with no reason.
 */
export function TraceNotices({ specsNotice, run }: TraceNoticesProps) {
  return (
    <>
      {specsNotice && (
        <p className="shrink-0 border-b border-data-warn/30 bg-data-warn/10 px-3 py-2 text-ui text-data-warn">
          {specsNotice}
        </p>
      )}
      <RunOutcomeBanner run={run} />
    </>
  );
}

function RunOutcomeBanner({ run }: { run: PipelineRunTrace }) {
  if ((run.status !== "failed" && run.status !== "unsupported") || !run.error_message) {
    return null;
  }
  return (
    <p
      className={
        run.status === "failed"
          ? "shrink-0 border-b border-data-neg/30 bg-data-neg/10 px-3 py-2 text-ui text-data-neg"
          : "shrink-0 border-b border-data-warn/30 bg-data-warn/10 px-3 py-2 text-ui text-data-warn"
      }
    >
      {run.error_message}
    </p>
  );
}
