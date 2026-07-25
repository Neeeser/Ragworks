"use client";

import type { RunSettingsSectionKey } from "@/lib/types";

export const CHAT_INPUT_MIN_HEIGHT = 40;
export const CHAT_INPUT_MAX_HEIGHT = 160;
export const DEFAULT_STREAMING_ENABLED = true;

export const TELEMETRY_SECTION_IDS = {
  systemPrompt: "telemetry-system-prompt",
  collectionTools: "telemetry-collection-tools",
  streaming: "telemetry-streaming",
  modelRouting: "telemetry-model-routing",
  providerRouting: "telemetry-provider-routing",
  modelParameters: "telemetry-model-parameters",
  vitals: "telemetry-collection-vitals",
  usage: "telemetry-usage",
} as const;

export const DEFAULT_TELEMETRY_ORDER: RunSettingsSectionKey[] = [
  "systemPrompt",
  "collectionTools",
  "streaming",
  "modelRouting",
  "providerRouting",
  "vitals",
  "modelParameters",
  "usage",
];
