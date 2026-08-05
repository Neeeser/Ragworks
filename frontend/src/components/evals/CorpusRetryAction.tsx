"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { retryFailedFiles } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

interface CorpusRetryActionProps {
  collectionId: string;
  /** Refetch whatever displays the corpus once the documents are queued. */
  onQueued?: () => void;
}

/**
 * Requeue an eval collection's corpus documents that never reached the index.
 *
 * An eval collection is an ordinary collection, so this is the same repair the
 * Files page offers. Scores come from a run, so repairing the corpus and
 * re-scoring are two steps: the result line says so rather than leaving the
 * user to wonder why the metrics above did not move.
 */
export function CorpusRetryAction({ collectionId, onQueued }: CorpusRetryActionProps) {
  const { token } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<number | null>(null);

  const retry = async () => {
    if (!token) return;
    setPending(true);
    setError(null);
    setQueued(null);
    try {
      const result = await retryFailedFiles(token, collectionId);
      setQueued(result.queued);
      onQueued?.();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not requeue the corpus documents"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex max-w-[80ch] flex-wrap items-center gap-x-3 gap-y-1">
      <Button size="sm" variant="secondary" loading={pending} onClick={retry}>
        Retry failed documents
      </Button>
      {error && <p className="text-ui text-data-neg">{error}</p>}
      {queued !== null && <p className="text-ui text-muted">{queuedMessage(queued)}</p>}
    </div>
  );
}

function queuedMessage(queued: number): string {
  if (queued === 0) {
    return "No document is waiting on a retry.";
  }
  const noun = queued === 1 ? "document" : "documents";
  return `${queued} ${noun} queued for ingestion. Scores come from a run — start a new one once ingestion finishes.`;
}
