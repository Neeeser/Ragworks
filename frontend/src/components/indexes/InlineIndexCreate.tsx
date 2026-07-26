"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { createIndex } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import { buildIndexCreatePayload } from "./create-index";

import type { IndexBackend, VectorIndex } from "@/lib/types";

type InlineIndexCreateProps = {
  token: string;
  backend: IndexBackend;
  /** "dense" | "sparse" — the plane the slot being filled reads. */
  vectorType: string;
  /** The width a dense index must store; null when the slot states none. */
  dimension: number | null;
  metric?: string | null;
  disabled?: boolean;
  onCreated: (index: VectorIndex) => void;
};

/**
 * Create an index without leaving the flow that needs it.
 *
 * The slot pins every parameter but the name, so this is a name and one
 * button — a user repointing a collection never has to open the registry, make
 * an index, and find their way back. Full control over placement, metric, and
 * dimension stays in the index registry; both paths shape their request
 * through `buildIndexCreatePayload`.
 */
export function InlineIndexCreate({
  token,
  backend,
  vectorType,
  dimension,
  metric,
  disabled,
  onCreated,
}: InlineIndexCreateProps) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const widthLabel = vectorType === "sparse" ? "BM25" : `${dimension}d`;

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await createIndex(
        token,
        buildIndexCreatePayload(backend, {
          name,
          vector_type: vectorType,
          ...(vectorType === "dense" && dimension != null
            ? { dimension, metric: metric ?? "cosine" }
            : {}),
        }),
      );
      onCreated(created);
      setName("");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create the index."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={`New ${widthLabel} index on ${backend}`}>
            <TextInput
              value={name}
              placeholder="new-index-name"
              disabled={disabled || creating}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          loading={creating}
          disabled={disabled || name.trim() === ""}
          onClick={handleCreate}
        >
          Create and use
        </Button>
      </div>
      {error ? <p className="text-ui text-data-neg">{error}</p> : null}
    </div>
  );
}

/**
 * Whether a slot states enough to promise a compatible index. A dense slot of
 * unknown width cannot, so creating one there belongs in the registry, where
 * the dimension is an explicit choice.
 */
export function canCreateForSlot(vectorType: string, dimension: number | null): boolean {
  return vectorType === "sparse" || dimension != null;
}
