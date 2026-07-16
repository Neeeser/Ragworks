import { Fragment } from "react";

const STOP_WORDS = new Set([
  "about",
  "does",
  "from",
  "into",
  "that",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const queryTerms = (query?: string | null): string[] => {
  if (!query) return [];
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])].filter(
    (term) => term.length >= 4 && !STOP_WORDS.has(term),
  );
};

type HighlightedTraceTextProps = {
  text: string;
  query?: string | null;
};

/** Preserve recorded text while marking meaningful terms from the retrieval query. */
export function HighlightedTraceText({ text, query }: HighlightedTraceTextProps) {
  const terms = queryTerms(query);
  if (!terms.length) return text;
  const pattern = new RegExp(`(${terms.map(escapePattern).join("|")})`, "giu");
  return text.split(pattern).map((part, index) =>
    terms.includes(part.toLowerCase()) ? (
      <mark key={`${part}-${index}`} className="rounded-sm bg-accent-cyan/15 px-0.5 text-primary">
        {part}
      </mark>
    ) : (
      <Fragment key={`${part}-${index}`}>{part}</Fragment>
    ),
  );
}
