"use client";

import { useCallback, useState } from "react";

import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";

import type { ApiKeyCreated, ApiKeyCreatePayload } from "@/lib/types/api-keys";
import type { UUID } from "@/lib/types/common";

/**
 * One user's API keys: the listing plus issue/revoke.
 *
 * The created key (with its one-time secret) is returned to the caller rather
 * than held here — only the component showing the secret should ever have it,
 * and it is never re-read from the server.
 */
export function useApiKeys(token: string) {
  const query = useApiQuery(() => listApiKeys(token), [token]);
  const reload = query.reload;
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const create = useCallback(
    async (payload: ApiKeyCreatePayload): Promise<ApiKeyCreated | null> => {
      setBusy(true);
      setMutationError(null);
      try {
        const created = await createApiKey(token, payload);
        reload();
        return created;
      } catch (err) {
        setMutationError(getErrorMessage(err, "Unable to create the key."));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [token, reload],
  );

  const revoke = useCallback(
    async (keyId: UUID): Promise<boolean> => {
      setBusy(true);
      setMutationError(null);
      try {
        await revokeApiKey(token, keyId);
        reload();
        return true;
      } catch (err) {
        setMutationError(getErrorMessage(err, "Unable to revoke the key."));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [token, reload],
  );

  return {
    keys: query.data?.keys ?? [],
    loading: query.loading,
    error: query.error ?? mutationError,
    busy,
    clearError: () => setMutationError(null),
    create,
    revoke,
  };
}
