/**
 * How a dataset's modalities read in the console.
 *
 * One module so the benchmark catalog, the dataset list, and the generate
 * wizard all name a modality the same way.
 */

import type { EvalModality } from "@/lib/types";

/** Every modality an eval dataset can carry, in wizard and chip order. */
export const EVAL_MODALITIES: readonly EvalModality[] = ["text", "image"];

export const MODALITY_LABEL: Record<EvalModality, string> = {
  text: "Text",
  image: "Images",
};

/**
 * The modalities worth showing as a chip.
 *
 * Text is the baseline every dataset carries, so a "Text" chip on every row
 * states nothing while pushing the one distinction that matters — an image
 * corpus — into the same visual weight as the norm.
 */
export function badgedModalities(modalities: EvalModality[] | undefined): EvalModality[] {
  return (modalities ?? []).filter((modality) => modality !== "text");
}
