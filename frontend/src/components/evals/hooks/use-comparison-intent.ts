"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { readComparisonParams, withPromptName } from "@/components/evals/lib/comparison-intent";

import type { PromptComparison } from "@/components/evals/NewRunWizard";
import type { PromptRead } from "@/lib/types";

/**
 * The prompt-comparison deep link the studio's version diff hands over.
 *
 * Seeded once into state rather than re-read per render: a deep link is a
 * one-shot intent, and re-applying it would overwrite whatever the user
 * chose after landing here.
 */
export function useComparisonIntent(prompts: PromptRead[] | null): {
  comparison: PromptComparison | null;
  requested: boolean;
  clear: () => void;
} {
  const searchParams = useSearchParams();
  const [intent, setIntent] = useState(() => readComparisonParams(searchParams));
  return {
    comparison: withPromptName(intent, prompts ?? []),
    requested: intent !== null,
    clear: () => setIntent(null),
  };
}
