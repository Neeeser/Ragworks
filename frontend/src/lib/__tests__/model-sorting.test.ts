import { describe, expect, it } from "vitest";

import { sortChatModels, sortEmbeddingModels } from "@/lib/model-sorting";
import { makeCatalogModel } from "@/test/fixtures";

import type { EmbeddingModelSortOption } from "@/lib/model-sorting";
import type { CatalogModel } from "@/lib/types";

describe("model-sorting", () => {
  it("keeps default chat model order", () => {
    const models: CatalogModel[] = [
      makeCatalogModel({ id: "a", name: "Alpha", supported_parameters: [] }),
      makeCatalogModel({ id: "b", name: "Beta", supported_parameters: [] }),
    ];
    expect(sortChatModels(models, "default")).toEqual(models);
  });

  it("sorts chat models by price then name", () => {
    const models: CatalogModel[] = [
      makeCatalogModel({
        id: "b",
        name: "Beta",
        pricing: { prompt: "$0.02" },
        supported_parameters: [],
      }),
      makeCatalogModel({
        id: "a",
        name: "Alpha",
        pricing: { prompt: "0.01" },
        supported_parameters: [],
      }),
      makeCatalogModel({
        id: "c",
        name: "Gamma",
        pricing: { prompt: null },
        supported_parameters: [],
      }),
      makeCatalogModel({
        id: "d",
        name: "Delta",
        pricing: { prompt: "0.005" },
        supported_parameters: [],
      }),
      makeCatalogModel({
        id: "e",
        name: "Epsilon",
        pricing: { prompt: Number.POSITIVE_INFINITY },
        supported_parameters: [],
      }),
    ];
    const sorted = sortChatModels(models, "price");
    expect(sorted.map((model) => model.name)).toEqual([
      "Delta",
      "Alpha",
      "Beta",
      "Epsilon",
      "Gamma",
    ]);
  });

  it("treats non-numeric pricing values as missing", () => {
    const models: CatalogModel[] = [
      makeCatalogModel({
        id: "a",
        name: "Alpha",
        pricing: { prompt: "abc" },
        supported_parameters: [],
      }),
      makeCatalogModel({
        id: "b",
        name: "Beta",
        pricing: { prompt: "0.01" },
        supported_parameters: [],
      }),
    ];
    const sorted = sortChatModels(models, "price");
    expect(sorted.map((model) => model.name)).toEqual(["Beta", "Alpha"]);
  });

  it("returns missing prices when no digits are present", () => {
    const models: CatalogModel[] = [
      makeCatalogModel({
        id: "a",
        name: "Alpha",
        pricing: { prompt: "$$" },
        supported_parameters: [],
      }),
      makeCatalogModel({
        id: "b",
        name: "Beta",
        pricing: { prompt: "$0.1" },
        supported_parameters: [],
      }),
    ];
    const sorted = sortChatModels(models, "price");
    expect(sorted.map((model) => model.name)).toEqual(["Beta", "Alpha"]);
  });

  it("treats non-finite numeric strings as missing", () => {
    const models: CatalogModel[] = [
      makeCatalogModel({
        id: "a",
        name: "Alpha",
        pricing: { prompt: "1e309" },
        supported_parameters: [],
      }),
      makeCatalogModel({
        id: "b",
        name: "Beta",
        pricing: { prompt: "0.01" },
        supported_parameters: [],
      }),
    ];
    const sorted = sortChatModels(models, "price");
    expect(sorted.map((model) => model.name)).toEqual(["Beta", "Alpha"]);
  });

  it("sorts embedding models by price", () => {
    const models: CatalogModel[] = [
      makeCatalogModel({ id: "a", name: "Alpha", pricing: { prompt: "0.5" } }),
      makeCatalogModel({ id: "b", name: "Beta", pricing: { completion: 0.1 } }),
      makeCatalogModel({ id: "c", name: "Gamma", pricing: null }),
      makeCatalogModel({ id: "d", name: "Delta", pricing: { prompt: 0.1 } }),
    ];
    const sorted = sortEmbeddingModels(models, "price");
    expect(sorted.map((model) => model.name)).toEqual(["Beta", "Delta", "Alpha", "Gamma"]);
  });

  it("sorts embedding models by dimension", () => {
    const models: CatalogModel[] = [
      makeCatalogModel({ id: "a", name: "Alpha", dimension: 1024 }),
      makeCatalogModel({ id: "b", name: "Beta", dimension: null }),
      makeCatalogModel({ id: "c", name: "Gamma", dimension: 512 }),
      makeCatalogModel({ id: "d", name: "Delta", dimension: 512 }),
    ];
    const sorted = sortEmbeddingModels(models, "dimension");
    expect(sorted.map((model) => model.name)).toEqual(["Delta", "Gamma", "Alpha", "Beta"]);
  });

  it("returns a copy when sorting embedding models", () => {
    const models: CatalogModel[] = [makeCatalogModel({ id: "a", name: "Alpha" })];
    const sorted = sortEmbeddingModels(models, "price");
    expect(sorted).not.toBe(models);
  });

  it("returns a copy for unsupported embedding sort options", () => {
    const models: CatalogModel[] = [
      makeCatalogModel({ id: "a", name: "Alpha", pricing: { prompt: 0.1 } }),
      makeCatalogModel({ id: "b", name: "Beta", pricing: { prompt: 0.2 } }),
    ];
    const sorted = sortEmbeddingModels(models, "unknown" as EmbeddingModelSortOption);
    expect(sorted).toEqual(models);
    expect(sorted).not.toBe(models);
  });
});
