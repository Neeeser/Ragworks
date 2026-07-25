import { Chip } from "@/components/ui/chip";

import type { ChipTone } from "@/components/ui/chip";
import type { ProviderKind } from "@/lib/types";

const KIND_LABELS: Record<ProviderKind, string> = {
  embedding: "Embeddings",
  chat: "Chat",
  reranking: "Reranking",
  vector_store: "Vector DB",
};

/**
 * Each capability wears the pipeline stage it serves, so the chip colour is a
 * function of the data rather than decoration and a connection's capabilities
 * read in the same colour language as the pipeline editor and trace viewer.
 */
const KIND_TONES: Record<ProviderKind, ChipTone> = {
  embedding: "embed",
  chat: "chat",
  reranking: "retrieve",
  vector_store: "index",
};

/** Capability chips rendered next to a provider type or connection. */
export function ProviderKindBadges({ kinds }: { kinds: ProviderKind[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {kinds.map((kind) => (
        <Chip key={kind} tone={KIND_TONES[kind] ?? "neutral"}>
          {KIND_LABELS[kind] ?? kind}
        </Chip>
      ))}
    </div>
  );
}
