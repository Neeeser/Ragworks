import type { ProviderConnection, ProviderTypeInfo } from "@/lib/types";

/** A provider type in the add-connection picker, with the connections the user already holds. */
export interface ProviderChoice {
  type: ProviderTypeInfo;
  connectedCount: number;
  /** True once the user holds this type's `max_connections_per_user` — the card is inert. */
  atLimit: boolean;
}

/**
 * Every non-builtin type becomes a choice, carrying its own connected count.
 * A type at its limit stays on the grid rather than disappearing: a provider
 * that vanishes once connected is indistinguishable from one this deployment
 * does not support, so a first-time user cannot tell which state they are in.
 */
export function toProviderChoices(
  providerTypes: ProviderTypeInfo[],
  existingConnections: ProviderConnection[],
): ProviderChoice[] {
  return providerTypes
    .filter((type) => !type.builtin)
    .map((type) => {
      const connectedCount = existingConnections.filter(
        (connection) => connection.provider_type === type.provider_type,
      ).length;
      const limit = type.max_connections_per_user;
      return { type, connectedCount, atLimit: limit != null && connectedCount >= limit };
    });
}
