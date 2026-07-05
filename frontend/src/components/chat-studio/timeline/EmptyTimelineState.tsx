interface EmptyTimelineStateProps {
  modelLabel: string;
  onModelSelect: () => void;
  overrideSections: Array<{ id: string; label: string }>;
  onOverrideSelect: (sectionId: string) => void;
}

export const EmptyTimelineState = ({
  modelLabel,
  onModelSelect,
  overrideSections,
  onOverrideSelect,
}: EmptyTimelineStateProps) => (
  <div className="flex h-full flex-col items-center justify-center gap-10 text-center">
    <div className="flex w-full max-w-md flex-col items-center">
      <button
        type="button"
        onClick={onModelSelect}
        className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-left text-xs text-slate-300 transition hover:border-white/30 hover:text-white"
      >
        <span className="shrink-0 text-[10px] uppercase tracking-[0.35em] text-slate-500">
          Model
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-white">{modelLabel}</span>
      </button>
    </div>
    <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/70 via-slate-950/40 to-cyan-950/30 p-6 text-left shadow-[0_30px_80px_-50px_rgba(56,189,248,0.35)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Overrides</p>
          <h4 className="text-lg font-semibold text-white">Run settings active</h4>
          <p className="text-sm text-slate-400">Tap a section to open it in Run settings.</p>
        </div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.4em] text-cyan-300">
          <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.85)]" />
          Live
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {overrideSections.length > 0 ? (
          overrideSections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onOverrideSelect(section.id)}
              className="rounded-full border border-cyan-200/30 bg-cyan-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-400/20"
            >
              {section.label}
            </button>
          ))
        ) : (
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
            No overrides yet
          </span>
        )}
      </div>
    </div>
  </div>
);
