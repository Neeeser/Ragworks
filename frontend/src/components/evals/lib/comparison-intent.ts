/** The prompt-comparison intent the studio hands over in the URL. */

import type { PromptComparison } from "@/components/evals/NewRunWizard";
import type { PromptRead } from "@/lib/types";

/**
 * Read `?prompt=&version_a=&version_b=` if all three are present and sane.
 *
 * A deep link is a one-shot intent: the caller reads it once and spends it,
 * so a later choice in the wizard can never be overwritten by re-reading.
 */
export function readComparisonParams(
  params: URLSearchParams | null,
): { promptId: string; versionA: number; versionB: number } | null {
  const promptId = params?.get("prompt");
  const versionA = Number(params?.get("version_a"));
  const versionB = Number(params?.get("version_b"));
  if (!promptId || !Number.isInteger(versionA) || !Number.isInteger(versionB)) return null;
  if (versionA < 1 || versionB < 1 || versionA === versionB) return null;
  return { promptId, versionA, versionB };
}

/** Name the intent's prompt once the library has loaded. */
export function withPromptName(
  intent: { promptId: string; versionA: number; versionB: number } | null,
  prompts: PromptRead[],
): PromptComparison | null {
  if (!intent) return null;
  const prompt = prompts.find((entry) => entry.id === intent.promptId);
  return {
    promptId: intent.promptId,
    promptName: prompt?.name ?? "prompt",
    versionA: intent.versionA,
    versionB: intent.versionB,
  };
}
