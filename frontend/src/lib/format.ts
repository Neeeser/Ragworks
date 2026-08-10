// Shared numeric/latency formatting helpers used across chat-studio, pipelines, and
// collections views. `formatPricePerMillion` was previously duplicated verbatim between
// ProviderRoutingCard and ModelSelectorCard (chat-studio/telemetry) and drifted into a
// simplified third copy in EmbeddingModelSelectorCard (pipelines); this file reconciles
// on the ProviderRoutingCard version, which is the most defensive of the three (it
// treats blank/whitespace-only strings as unparseable rather than coercing them to 0).

import { parseApiDate } from "@/lib/datetime";

export const formatPricePerMillion = (value?: number | string | null): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parseNumber = (input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    const cleaned = trimmed.replace(/[^0-9eE.+-]/g, "");
    if (!cleaned) {
      return null;
    }
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const raw = typeof value === "number" ? value : parseNumber(String(value));
  if (raw === null || !Number.isFinite(raw)) {
    const fallback = String(value).trim();
    return fallback || null;
  }
  // OpenRouter reports routed meta-models (Auto Router, …) with a negative
  // sentinel price; treat any negative value as variable — the real cost
  // depends on where the request lands.
  if (raw < 0) {
    return "Variable";
  }
  const pricePerMillion = raw * 1_000_000;
  const trimFractionDigits = (numericString: string, minFractionDigits: number) => {
    if (!numericString.includes(".")) {
      return numericString;
    }
    const [whole, fraction] = numericString.split(".");
    if (fraction.length <= minFractionDigits) {
      return `${whole}.${fraction.padEnd(minFractionDigits, "0")}`;
    }
    let trimmedFraction = fraction;
    while (trimmedFraction.length > minFractionDigits && trimmedFraction.endsWith("0")) {
      trimmedFraction = trimmedFraction.slice(0, -1);
    }
    /* c8 ignore next -- minFractionDigits is never zero when a fraction exists */
    return trimmedFraction.length > 0 ? `${whole}.${trimmedFraction}` : whole;
  };

  let minFractionDigits = 0;
  let maxFractionDigits = 0;
  if (pricePerMillion >= 100) {
    minFractionDigits = 0;
    maxFractionDigits = 0;
  } else if (pricePerMillion >= 10) {
    minFractionDigits = 1;
    maxFractionDigits = 1;
  } else if (pricePerMillion >= 1) {
    minFractionDigits = 2;
    maxFractionDigits = 2;
  } else if (pricePerMillion >= 0.1) {
    minFractionDigits = 2;
    maxFractionDigits = 3;
  } else if (pricePerMillion >= 0.01) {
    minFractionDigits = 2;
    maxFractionDigits = 4;
  } else {
    minFractionDigits = 2;
    maxFractionDigits = 6;
  }
  const fixed = pricePerMillion.toFixed(maxFractionDigits);
  const normalized = trimFractionDigits(fixed, minFractionDigits);
  return `$${normalized}/M`;
};

export const formatLatency = (latency?: number | null): string => {
  if (!latency || Number.isNaN(latency)) {
    // Em-dash, not "n/a": absent data reads as absent rather than as a value.
    return "—";
  }
  return `${Math.round(latency)} ms`;
};

/**
 * Compact token-count label for a model's context window, e.g. 128000 -> "128K",
 * 2_000_000 -> "2M". Rounds to whole K below a million and one decimal at/above it;
 * a count that rounds up to 1000K is promoted to "1M" so the K/M boundary is clean.
 */
export const formatContextLength = (tokens: number): string => {
  if (tokens < 1_000) {
    return tokens.toLocaleString();
  }
  const thousands = Math.round(tokens / 1_000);
  if (thousands >= 1_000) {
    return `${(tokens / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  }
  return `${thousands.toLocaleString()}K`;
};

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * A byte count in the largest unit that keeps it under four significant
 * characters, e.g. `512 B`, `2.0 KB`, `15 MB`.
 *
 * Shared rather than per-feature because a hand-rolled `/1024` drifts on the
 * details that matter in a column — which unit it stops at, and how many
 * fraction digits it keeps — and a size column whose rows disagree on either is
 * unreadable. It lived in the files feature until the design language named this
 * module as the one place bytes are formatted.
 */
export const formatBytes = (size: number): string => {
  if (size <= 0) {
    return "0 B";
  }
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = size / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
};

/** Group-separated count — token totals, event counts, anything countable. */
export const formatCount = (value: number): string => value.toLocaleString();

/**
 * A dollar amount at the precision the number actually needs: embedding spend
 * is routinely fractions of a cent, and rounding it to two places prints $0.00
 * for a real cost. Written out in full rather than via `toPrecision`, which
 * switches to exponent notation below 1e-7 — "$3.0e-8" is not a price.
 */
export const formatUsd = (cost: number): string => {
  if (cost === 0) return "$0";
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  const decimals = Math.min(12, 1 - Math.floor(Math.log10(cost)));
  return `$${cost.toFixed(decimals).replace(/0+$/, "")}`;
};

/**
 * Compact relative timestamp for a table column: "now", "5m", "3h", "6d", then
 * an absolute short date beyond a week ("Jul 24").
 *
 * A column is the wrong place for prose. `timeAgo` renders "less than a minute
 * ago", which is ~22 characters for one datum and forces the column wide enough
 * to unbalance every row beside it; a list wants the shortest form that is still
 * unambiguous, with the exact value available on hover via `title`.
 */
export const formatTimeAgoCompact = (dateLike?: string | Date | null): string => {
  if (!dateLike) return "—";
  const date = typeof dateLike === "string" ? parseApiDate(dateLike) : dateLike;
  if (!date || Number.isNaN(date.getTime())) return "—";

  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.round(days)}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
};
