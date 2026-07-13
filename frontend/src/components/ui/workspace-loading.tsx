export function WorkspaceLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-canvas px-6 text-body"
      role="status"
      aria-live="polite"
    >
      <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-cyan motion-reduce:animate-none"
          aria-hidden
        />
        Preparing your workspace…
      </p>
    </div>
  );
}
