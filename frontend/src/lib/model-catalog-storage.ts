import type { ModelCatalogResponse, UUID } from "@/lib/types";

/**
 * The last catalog each (user, kind) returned, kept for the next page load.
 *
 * A model catalog is only fetched once the auth refresh has resolved, so a
 * reload spends most of a second with nothing to show and paints a skeleton
 * where the user's models were a moment ago. Reading the previous answer back
 * lets the picker paint immediately and revalidate behind it; the request is
 * still made every time, so nothing here is ever the final word.
 *
 * `sessionStorage`, not `localStorage`: this is a convenience copy of one
 * tab's last answer, and it names the user's connections — it should not
 * outlive the tab.
 */

const PREFIX = "ragworks.modelCatalog";

/** Catalogs above this are not worth the quota they would take from the tab. */
const MAX_BYTES = 1_500_000;

const storageKey = (userId: UUID, kind: string) => `${PREFIX}:${userId}:${kind}`;

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Storage access throws outright under some privacy settings.
    return null;
  }
}

/** The stored catalog for this user and kind, or null when there is none. */
export function readStoredCatalog(userId: UUID, kind: string): ModelCatalogResponse | null {
  const store = session();
  if (!store) return null;
  const raw = store.getItem(storageKey(userId, kind));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCatalog(parsed) ? parsed : null;
  } catch {
    // A truncated or hand-edited entry is not worth reporting — it is a cache.
    return null;
  }
}

export function writeStoredCatalog(
  userId: UUID,
  kind: string,
  catalog: ModelCatalogResponse,
): void {
  const store = session();
  if (!store) return;
  const serialized = JSON.stringify(catalog);
  if (serialized.length > MAX_BYTES) return;
  try {
    store.setItem(storageKey(userId, kind), serialized);
  } catch {
    // Over quota: the picker still works, it just starts empty next load.
  }
}

/** Drop every catalog stored for a user — called when their session ends. */
export function clearStoredCatalogs(userId: UUID): void {
  const store = session();
  if (!store) return;
  const prefix = `${PREFIX}:${userId}:`;
  // Collected first: removing while walking the index shifts what is left.
  // `key(i)` rather than `Object.keys`, which is not part of the Storage API.
  const doomed: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(prefix)) doomed.push(key);
  }
  for (const key of doomed) store.removeItem(key);
}

function isCatalog(value: unknown): value is ModelCatalogResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ModelCatalogResponse>;
  return (
    Array.isArray(candidate.models) &&
    Array.isArray(candidate.connection_errors) &&
    typeof candidate.meta === "object" &&
    candidate.meta !== null
  );
}
