/**
 * Model-aware chunking defaults for the setup wizard.
 *
 * A good starting chunk size for retrieval is ~512 tokens (recursive-512
 * benchmarks well and larger windows lose precision), with overlap at ~20% of
 * the chunk size — the conventional recommendation. The only hard constraint is
 * that a chunk fits the embedding model's context window: each emitted chunk
 * spans at most `chunkSize` tokens (overlap is a stride *within* the window, not
 * extra tokens the embedder sees), so `chunkSize` is capped at the model's
 * effective window and never the size-plus-overlap sum. These are only the
 * defaults the wizard fills in — the user can still raise either value.
 */

/** Preferred starting chunk size when the model's window allows it. */
export const DEFAULT_CHUNK_SIZE = 512;

/** Overlap as a fraction of chunk size (~20%, the conventional default). */
export const CHUNK_OVERLAP_RATIO = 0.2;

/**
 * Default overlap in tokens, derived from the ratio rather than written as a
 * literal — a hardcoded number silently becomes a different proportion when
 * the size default moves, which is how the node and the wizard came to
 * disagree about what a default overlap is. Mirrors `DEFAULT_CHUNK_OVERLAP`
 * in `app/pipelines/nodes/chunking.py`.
 */
export const DEFAULT_CHUNK_OVERLAP = Math.round(DEFAULT_CHUNK_SIZE * CHUNK_OVERLAP_RATIO);

/**
 * Tokens reserved for the model's special tokens (CLS/SEP, etc.). Mirrors the
 * backend's `EMBEDDING_INPUT_MARGIN_TOKENS` so the wizard's cap matches the
 * limit ingestion enforces.
 */
export const EMBEDDING_INPUT_MARGIN_TOKENS = 16;

export interface ChunkDefaults {
  chunkSize: number;
  chunkOverlap: number;
}

/** The model's usable window after reserving the special-token margin. */
export function effectiveInputLimit(maxInputTokens: number | null | undefined): number | null {
  if (typeof maxInputTokens !== "number" || maxInputTokens <= 0) return null;
  return Math.max(1, maxInputTokens - EMBEDDING_INPUT_MARGIN_TOKENS);
}

/**
 * Compute the default chunk size and overlap for an embedding model.
 *
 * `chunkSize` is `min(512, effectiveWindow)`; an unknown window (models that
 * don't report a limit) falls back to 512. Overlap is 20% of the chosen size,
 * clamped below the size so the chunker's `overlap < chunk_size` rule holds.
 */
export function chunkDefaultsFor(maxInputTokens: number | null | undefined): ChunkDefaults {
  const window = effectiveInputLimit(maxInputTokens);
  const chunkSize = window != null ? Math.min(DEFAULT_CHUNK_SIZE, window) : DEFAULT_CHUNK_SIZE;
  const chunkOverlap = Math.min(Math.round(chunkSize * CHUNK_OVERLAP_RATIO), chunkSize - 1);
  return { chunkSize, chunkOverlap: Math.max(0, chunkOverlap) };
}

export interface ChunkWindow {
  /** Tokens in each emitted chunk — the number the embedder actually sees. */
  perChunk: number;
  /** Tokens of document text each chunk advances by (`chunkSize - overlap`). */
  newText: number;
  /** Tokens repeated from the tail of the previous chunk. */
  repeated: number;
  /** True when overlap is not smaller than the size, which the chunker rejects. */
  invalid: boolean;
}

/**
 * Break a chunk size and overlap into the three numbers a reader needs.
 *
 * Overlap is a stride *within* the window, not extra tokens on top of it: the
 * chunker takes windows of `chunkSize` and steps forward by
 * `chunkSize - overlap`, so each emitted chunk is `chunkSize` tokens of which
 * `overlap` repeat the previous chunk's tail. Reading `chunkSize` as "new text
 * per chunk, plus overlap on top" is the intuitive misreading, and it is what
 * this breakdown exists to prevent.
 */
export function describeChunkWindow(chunkSize: number, overlap: number): ChunkWindow {
  const size = Math.max(0, Math.trunc(chunkSize));
  const repeated = Math.max(0, Math.trunc(overlap));
  return {
    perChunk: size,
    newText: Math.max(0, size - repeated),
    repeated,
    invalid: size <= 0 || repeated >= size,
  };
}
