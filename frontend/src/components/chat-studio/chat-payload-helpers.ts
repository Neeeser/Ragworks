"use client";

import { parsePriceInput } from "./chat-utils";

import type { ProviderFormState } from "@/components/chat-studio/types";
import type { ProviderPreferences, ProviderSortOption } from "@/lib/types";

export const createDefaultProviderForm = (): ProviderFormState => ({
  sort: "",
  order: [],
  only: [],
  ignore: [],
  quantizations: [],
  allowFallbacks: true,
  requireParameters: false,
  dataCollection: "allow",
  zdr: false,
  enforceDistillableText: false,
  maxPrompt: "",
  maxCompletion: "",
  maxRequest: "",
  maxImage: "",
});

export const createProviderFormFromPreferences = (
  preferences?: ProviderPreferences | null,
): ProviderFormState => {
  const defaults = createDefaultProviderForm();
  if (!preferences) {
    return defaults;
  }
  const maxPrice = preferences.max_price ?? {};
  return {
    ...defaults,
    order: preferences.order ?? [],
    only: preferences.only ?? [],
    ignore: preferences.ignore ?? [],
    quantizations: preferences.quantizations ?? [],
    sort: preferences.sort ?? "",
    allowFallbacks: preferences.allow_fallbacks ?? true,
    requireParameters: preferences.require_parameters ?? false,
    dataCollection: preferences.data_collection ?? "allow",
    zdr: preferences.zdr ?? false,
    enforceDistillableText: preferences.enforce_distillable_text ?? false,
    maxPrompt: maxPrice.prompt != null ? String(maxPrice.prompt) : "",
    maxCompletion: maxPrice.completion != null ? String(maxPrice.completion) : "",
    maxRequest: maxPrice.request != null ? String(maxPrice.request) : "",
    maxImage: maxPrice.image != null ? String(maxPrice.image) : "",
  };
};

/** Inverse of {@link createProviderFormFromPreferences}: collapses the provider form
 * into a sparse `ProviderPreferences` payload, omitting defaults and empty values. */
export const buildProviderPayload = (providerForm: ProviderFormState): ProviderPreferences => {
  const payload: ProviderPreferences = {};
  if (providerForm.order.length > 0) {
    payload.order = providerForm.order;
  }
  if (providerForm.only.length > 0) {
    payload.only = providerForm.only;
  }
  if (providerForm.ignore.length > 0) {
    payload.ignore = providerForm.ignore;
  }
  if (providerForm.quantizations.length > 0) {
    payload.quantizations = providerForm.quantizations.map((entry) => entry.toLowerCase());
  }
  if (providerForm.sort) {
    payload.sort = providerForm.sort as ProviderSortOption;
  }
  if (!providerForm.allowFallbacks) {
    payload.allow_fallbacks = false;
  }
  if (providerForm.requireParameters) {
    payload.require_parameters = true;
  }
  if (providerForm.dataCollection === "deny") {
    payload.data_collection = "deny";
  }
  if (providerForm.zdr) {
    payload.zdr = true;
  }
  if (providerForm.enforceDistillableText) {
    payload.enforce_distillable_text = true;
  }
  const maxPrice: ProviderPreferences["max_price"] = {};
  const promptPrice = parsePriceInput(providerForm.maxPrompt);
  if (promptPrice !== null) {
    maxPrice.prompt = promptPrice;
  }
  const completionPrice = parsePriceInput(providerForm.maxCompletion);
  if (completionPrice !== null) {
    maxPrice.completion = completionPrice;
  }
  const requestPrice = parsePriceInput(providerForm.maxRequest);
  if (requestPrice !== null) {
    maxPrice.request = requestPrice;
  }
  const imagePrice = parsePriceInput(providerForm.maxImage);
  if (imagePrice !== null) {
    maxPrice.image = imagePrice;
  }
  if (maxPrice && Object.keys(maxPrice).length > 0) {
    payload.max_price = maxPrice;
  }
  return payload;
};
