// Shared numeric/latency formatting helpers used across chat-studio, pipelines, and
// collections views. `formatPricePerMillion` was previously duplicated verbatim between
// ProviderRoutingCard and ModelSelectorCard (chat-studio/telemetry) and drifted into a
// simplified third copy in EmbeddingModelSelectorCard (pipelines); this file reconciles
// on the ProviderRoutingCard version, which is the most defensive of the three (it
// treats blank/whitespace-only strings as unparseable rather than coercing them to 0).

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
  // sentinel price — the real cost depends on where the request lands.
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
    return "n/a";
  }
  return `${Math.round(latency)} ms`;
};
