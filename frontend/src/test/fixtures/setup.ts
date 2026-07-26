import type { SetupStatus } from "@/lib/types";

export function makeSetupStatus(overrides: Partial<SetupStatus> = {}): SetupStatus {
  // A brand-new workspace: pgvector ships built in, so `has_vector_store` is
  // the one capability already true before the user connects anything.
  return {
    has_embedding_provider: false,
    has_chat_provider: false,
    has_vector_store: true,
    has_index: false,
    has_collection: false,
    setup_complete: false,
    ...overrides,
  };
}
