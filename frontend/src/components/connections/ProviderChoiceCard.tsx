import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

import type { ProviderChoice } from "@/components/connections/lib/provider-choices";

/**
 * The card's one corner slot, in priority order: a provider already at its
 * connection limit says so, a partly-connected one shows its count, and only an
 * unconnected one is still worth recommending.
 */
function CornerChip({ choice }: { choice: ProviderChoice }) {
  if (choice.atLimit) {
    return (
      <Chip tone="pos" className="absolute right-2 top-2">
        Connected
      </Chip>
    );
  }
  if (choice.connectedCount > 0) {
    return (
      <Chip tone="neutral" dot={false} className="absolute right-2 top-2">
        {choice.connectedCount} connected
      </Chip>
    );
  }
  if (choice.type.recommended) {
    return (
      <Chip tone="accent" dot={false} className="absolute right-2 top-2">
        Recommended
      </Chip>
    );
  }
  return null;
}

/**
 * One provider in the picker grid. A card at its connection limit is a real
 * `disabled` button — it keeps its name and capability chips so the provider
 * still reads as supported, but drops its hover treatment so it never invites a
 * click the form behind it could only reject.
 */
export function ProviderChoiceCard({
  choice,
  onPick,
}: {
  choice: ProviderChoice;
  onPick: () => void;
}) {
  const { type, atLimit } = choice;
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={atLimit}
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-control border border-hairline bg-surface p-3 text-center transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        atLimit ? "cursor-not-allowed opacity-60" : "hover:border-strong hover:bg-surface-strong",
      )}
    >
      <CornerChip choice={choice} />
      <ProviderIcon
        providerType={type.provider_type}
        className={cn(
          "mt-3 h-8 w-8 text-muted transition-colors duration-80 ease-standard",
          atLimit ? null : "group-hover:text-accent-violet",
        )}
      />
      <span className="text-ui font-medium text-primary">{type.label}</span>
      <ProviderKindBadges kinds={type.kinds} />
    </button>
  );
}
