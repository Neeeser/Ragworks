/** Shared sentence fragments the node explanations build their copy from. */

/** A count with its noun, pluralized: `1 image`, `3 images`. */
export const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;
