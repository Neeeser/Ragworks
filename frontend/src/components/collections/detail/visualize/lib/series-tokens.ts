/**
 * The categorical chart series, in fixed order. UI accents are deliberately
 * absent: `--accent-cyan` sits outside the categorical lightness band, so beside
 * violet it out-shines its peer and two clusters stop reading as equal.
 *
 * Cluster slots cycle past six rather than inventing hues: a generated seventh
 * colour would land wherever the arithmetic put it, which is how a palette
 * validated for contrast and colour-vision separation quietly stops being
 * either. Two clusters sharing a colour is a real cost, and the on-canvas
 * cluster labels are what pay it — never colour alone.
 */
export const SERIES_TOKENS = [
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
] as const;

/** The series slot a cluster paints with; noise (null) gets no slot. */
export function clusterSeriesIndex(clusterIndex: number | null): number | null {
  if (clusterIndex === null || clusterIndex < 0) {
    return null;
  }
  return clusterIndex % SERIES_TOKENS.length;
}
