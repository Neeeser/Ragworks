import type { ProviderKind } from "@/lib/types";

const KIND_LABELS: Record<ProviderKind, string> = {
  embedding: "Embeddings",
  chat: "Chat",
  vector_store: "Vector DB",
};

/** Capability badges rendered next to a provider type or connection. */
export function ProviderKindBadges({ kinds }: { kinds: ProviderKind[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {kinds.map((kind) => (
        <span
          key={kind}
          className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-meta"
        >
          {KIND_LABELS[kind] ?? kind}
        </span>
      ))}
    </div>
  );
}
