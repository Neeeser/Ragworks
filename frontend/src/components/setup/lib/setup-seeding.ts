import { resumeStep } from "@/components/setup/lib/setup-resume";
import { defaultIndexName } from "@/lib/default-index-name";

import type {
  SetupWizardAction,
  SetupWizardState,
} from "@/components/setup/lib/setup-wizard-reducer";
import type { BackendInfo, SetupStatus, User } from "@/lib/types";
import type { Dispatch } from "react";

export interface SetupSeedContext {
  status: SetupStatus | null;
  user: User | null;
  backends: BackendInfo[] | null;
}

/**
 * Place a returning user on the right step and suggest their index name.
 *
 * Called during render, not from an effect: an effect paints the welcome step
 * (and an empty name field) first and corrects a frame later, and re-fires on
 * every background status refresh — the auth provider rotates its token every
 * 12 minutes. Both actions latch in the reducer, so each applies once and
 * neither can undo a step the user went back to or a name they typed.
 */
export function applySetupSeeds(
  state: SetupWizardState,
  dispatch: Dispatch<SetupWizardAction>,
  { status, user, backends }: SetupSeedContext,
): void {
  if (!state.resumed && status) {
    const target = resumeStep(status);
    if (target !== state.step) dispatch({ type: "RESUME", step: target });
  }
  if (state.indexNameSeeded || !user) return;
  // The backend's own name-length rule, never a limit repeated here.
  const limit = backends?.find((backend) => backend.backend === state.choices.backend)?.capabilities
    .index_name_max_length;
  if (limit) dispatch({ type: "SEED_INDEX_NAME", name: defaultIndexName(user, limit) });
}
