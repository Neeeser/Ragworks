"use client";

interface StreamingSettingsCardProps {
  streamingEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const StreamingSettingsCard = ({
  streamingEnabled,
  onToggle,
}: StreamingSettingsCardProps) => {
  return (
    <div className="space-y-2 rounded-2xl border border-hairline bg-surface p-3 text-sm text-body">
      <label className="flex items-center justify-between gap-3 text-sm text-body">
        <span className="font-medium text-primary">Enable streaming</span>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-strong bg-transparent"
          checked={streamingEnabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </label>
      <p className="text-xs text-muted">
        Stream completions to this console via Server-Sent Events for real-time feedback.
      </p>
    </div>
  );
};
