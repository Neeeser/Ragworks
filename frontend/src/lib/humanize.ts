/**
 * Turning machine identifiers into readable labels.
 *
 * Pipeline arguments and variables are authored as snake_case keys the API
 * accepts verbatim (`result_limit`), and rendering that key as a form label
 * hands a first-time user a machine id where a human label belongs. The
 * identifier still has to be visible somewhere — it is what the caller sends —
 * so it moves to secondary metadata and this derives the label beside it.
 */

/**
 * Segments whose canonical rendering is not a capitalized word.
 *
 * Matched case-insensitively against a whole segment, never a substring, so
 * `id` becomes `ID` while `identity` is left alone.
 */
const ACRONYMS = new Map<string, string>(
  ["ID", "IDs", "UUID", "URL", "URI", "API", "LLM", "MCP", "BM25", "RRF", "JSON", "MIME"].map(
    (word) => [word.toLowerCase(), word],
  ),
);

const SEPARATORS = /[\s_-]+/;

/**
 * The human label for a machine identifier.
 *
 * The rule, in full: split on `_`, `-`, and whitespace; map any segment that
 * names an acronym to its canonical form; lowercase any segment written in all
 * caps; leave every other segment exactly as written; capitalize the first
 * segment. So `result_limit` reads "Result limit", `RESULT_LIMIT` reads the
 * same, `doc_id` reads "Doc ID", and an already-humanized "Result limit" comes
 * back unchanged — the function is idempotent on its own output.
 *
 * Mixed-case segments are preserved rather than re-cased, so a deliberately
 * spelled name is never mangled into something its author did not write.
 * Returns the trimmed input when there is nothing to split (an empty or
 * separator-only identifier), leaving the caller free to fall back to the raw
 * value.
 */
export function humanizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  const segments = trimmed.split(SEPARATORS).filter(Boolean);
  if (segments.length === 0) return trimmed;

  const words = segments.map((segment) => {
    const acronym = ACRONYMS.get(segment.toLowerCase());
    if (acronym) return acronym;
    // An all-caps segment is a shouted machine id, not an authored spelling.
    return segment === segment.toUpperCase() ? segment.toLowerCase() : segment;
  });

  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}
