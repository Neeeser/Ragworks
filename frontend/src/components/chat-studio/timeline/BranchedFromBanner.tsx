interface BranchedFromBannerProps {
  className: string;
  branchedFromSessionId: string | null;
  branchedFromLabel: string;
  onNavigateToSession: (sessionId: string) => void;
}

export const BranchedFromBanner = ({
  className,
  branchedFromSessionId,
  branchedFromLabel,
  onNavigateToSession,
}: BranchedFromBannerProps) => (
  <div className={className}>
    <span className="text-[9px] uppercase tracking-[0.35em] text-slate-500">Branched from</span>
    {branchedFromSessionId ? (
      <button
        type="button"
        onClick={() => onNavigateToSession(branchedFromSessionId)}
        className="text-slate-100 underline-offset-4 hover:underline"
      >
        {branchedFromLabel}
      </button>
    ) : (
      <span>{branchedFromLabel}</span>
    )}
  </div>
);
