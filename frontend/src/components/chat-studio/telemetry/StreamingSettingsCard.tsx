"use client";

import { Checkbox } from "@/components/ui/checkbox";

interface StreamingSettingsCardProps {
  streamingEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const StreamingSettingsCard = ({
  streamingEnabled,
  onToggle,
}: StreamingSettingsCardProps) => (
  <Checkbox
    checked={streamingEnabled}
    onChange={onToggle}
    label="Enable streaming"
    description="Tokens arrive over Server-Sent Events as the model produces them; with it off, the reply appears once the turn completes."
  />
);
