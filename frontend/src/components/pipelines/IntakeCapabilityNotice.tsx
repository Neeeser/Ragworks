"use client";

type IntakeCapabilityNoticeProps = {
  /** The intake preset needs a capability the model states it lacks. */
  conflict: string | null;
  /** The model states nothing about the capability the preset needs. */
  unknown: string | null;
  onDismissUnknown: () => void;
};

/**
 * What a selected model and the chosen intake preset say about each other —
 * rendered under whichever model the preset makes a demand of, the embedder or
 * the vision shell.
 *
 * A conflict is an error the wizard gates on; an unstated capability is a
 * warning the user dismisses, because absence of a capability mark means "not
 * stated", never "cannot".
 */
export function IntakeCapabilityNotice({
  conflict,
  unknown,
  onDismissUnknown,
}: IntakeCapabilityNoticeProps) {
  return (
    <>
      {conflict ? (
        <p
          role="alert"
          className="mt-2 max-w-[66ch] rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2 text-ui text-data-neg"
        >
          {conflict}
        </p>
      ) : null}
      {unknown ? (
        <div
          role="status"
          className="mt-2 flex max-w-[66ch] items-start gap-3 rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2 text-ui text-data-warn"
        >
          <p className="min-w-0 flex-1">{unknown}</p>
          <button
            type="button"
            onClick={onDismissUnknown}
            className="shrink-0 rounded-control text-instrument underline-offset-2 transition-colors duration-80 ease-standard hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
