import type { CatalogModel, ModelPricing } from "@/lib/types";

export type ChatModelSortOption = "default" | "price";
export type EmbeddingModelSortOption = "price" | "dimension";

const normalizePrice = (value?: number | string | null): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const cleaned = String(value)
    .trim()
    .replace(/[^0-9eE.+-]/g, "");
  if (!/[0-9]/.test(cleaned)) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveModelPrice = (pricing?: ModelPricing | null): number | null => {
  if (!pricing) return null;
  return (
    normalizePrice(pricing.prompt) ??
    normalizePrice(pricing.request) ??
    normalizePrice(pricing.completion)
  );
};

const compareNullableNumbers = (a: number | null, b: number | null) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};

const compareNames = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export const sortChatModels = (models: CatalogModel[], option: ChatModelSortOption) => {
  if (option === "default") {
    return [...models];
  }
  const sorted = [...models];
  sorted.sort((a, b) => {
    const priceCompare = compareNullableNumbers(
      resolveModelPrice(a.pricing),
      resolveModelPrice(b.pricing),
    );
    return priceCompare !== 0 ? priceCompare : compareNames(a, b);
  });
  return sorted;
};

export const sortEmbeddingModels = (models: CatalogModel[], option: EmbeddingModelSortOption) => {
  const sorted = [...models];
  if (option === "price") {
    sorted.sort((a, b) => {
      const priceCompare = compareNullableNumbers(
        resolveModelPrice(a.pricing),
        resolveModelPrice(b.pricing),
      );
      return priceCompare !== 0 ? priceCompare : compareNames(a, b);
    });
    return sorted;
  }
  if (option === "dimension") {
    sorted.sort((a, b) => {
      const dimCompare = compareNullableNumbers(
        typeof a.dimension === "number" ? a.dimension : null,
        typeof b.dimension === "number" ? b.dimension : null,
      );
      return dimCompare !== 0 ? dimCompare : compareNames(a, b);
    });
    return sorted;
  }
  return sorted;
};
