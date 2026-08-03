/** One version flattened to text, so a diff covers everything it holds. */

import type { PromptVersionRead } from "@/lib/types";

/**
 * Render a version as the lines a diff compares.
 *
 * A version is more than its body — the system message and the
 * output-field schema version with it — so diffing the body alone reports
 * "no changes" for a version that changed either, which reads as a broken
 * diff rather than a real one.
 */
export function versionDiffText(version: PromptVersionRead): string {
  const sections = [`## User message`, version.body];
  if (version.system_body) {
    sections.unshift(`## System message`, version.system_body, "");
  }
  const fields = version.output_fields ?? [];
  if (fields.length > 0) {
    sections.push("", "## Output fields", ...fields.map((field) => JSON.stringify(field)));
  }
  return sections.join("\n");
}
