import type { ProviderConnection } from "@/lib/types";

/**
 * Whether a connection may satisfy a capability gate.
 *
 * Two ways a listed row cannot serve models. `config_valid: false` means the
 * stored config no longer parses. A null `last_validated_at` means nothing has
 * ever reached the server: the row still reports kinds, but those are the
 * provider type's *declared* kinds rather than measured ones, and a declared
 * set can be wider than what the server serves. Either way the row lists — so
 * it stays visible and editable — and counts for nothing.
 *
 * The backend enforces the same rule in `ConnectionService.coverage`; both
 * gates move together or a picker offers a model the API then refuses.
 */
export function isConnectionUsable(connection: ProviderConnection): boolean {
  return connection.config_valid !== false && connection.last_validated_at !== null;
}
