"use client";

import { DEFAULT_TELEMETRY_ORDER } from "@/components/chat-studio/chat-constants";

import type { RunSettingsSectionKey } from "@/lib/types";

const TELEMETRY_SECTION_SET = new Set(DEFAULT_TELEMETRY_ORDER);

export const normalizeRunSettingsOrder = (
  order?: RunSettingsSectionKey[] | null,
): RunSettingsSectionKey[] => {
  if (!order || order.length === 0) {
    return [...DEFAULT_TELEMETRY_ORDER];
  }
  const seen = new Set<RunSettingsSectionKey>();
  const normalized: RunSettingsSectionKey[] = [];
  for (const entry of order) {
    if (!TELEMETRY_SECTION_SET.has(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    normalized.push(entry);
  }
  for (const entry of DEFAULT_TELEMETRY_ORDER) {
    if (!seen.has(entry)) {
      normalized.push(entry);
    }
  }
  return normalized;
};

export const generateClientSessionId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    if (char === "x") {
      return rand.toString(16);
    }
    // Ensure the variant bits are 10xx for UUID v4 compatibility
    return ((rand & 0x3) | 0x8).toString(16);
  });
};

export const generateClientMessageId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `client-${crypto.randomUUID()}`;
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

/** Generates a fallback id for a live tool call/result event when the server-sent event
 * doesn't carry its own id. */
export const makeToolId = () =>
  `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const parseCollectionIdsParam = (value: string | null): string[] => {
  if (!value) {
    return [];
  }
  const seen = new Set<string>();
  return value.split(",").reduce<string[]>((acc, raw) => {
    const decoded = decodeURIComponent(raw.trim());
    if (!decoded || seen.has(decoded)) {
      return acc;
    }
    seen.add(decoded);
    acc.push(decoded);
    return acc;
  }, []);
};

export const areArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

export const buildCollectionsQuery = (collectionIds: string[]): string => {
  if (collectionIds.length === 0) {
    return "";
  }
  const encoded = collectionIds.map((collectionId) => encodeURIComponent(collectionId));
  return `collections=${encoded.join(",")}`;
};
