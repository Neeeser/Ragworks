import { InstrumentLabel } from "@/components/ui/instrument-label";

interface BranchedFromBannerProps {
  className: string;
  branchedFromSessionId: string | null;
  branchedFromLabel: string;
  onNavigateToSession: (sessionId: string) => void;
}

/** Where this turn came from, when the session was branched off another one. */
export const BranchedFromBanner = ({
  className,
  branchedFromSessionId,
  branchedFromLabel,
  onNavigateToSession,
}: BranchedFromBannerProps) => (
  <div className={className}>
    <InstrumentLabel>Branched from</InstrumentLabel>
    {branchedFromSessionId ? (
      <button
        type="button"
        onClick={() => onNavigateToSession(branchedFromSessionId)}
        className="rounded-control text-ui text-body underline-offset-4 transition-colors duration-80 ease-standard hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
      >
        {branchedFromLabel}
      </button>
    ) : (
      <span className="text-ui text-body">{branchedFromLabel}</span>
    )}
  </div>
);
