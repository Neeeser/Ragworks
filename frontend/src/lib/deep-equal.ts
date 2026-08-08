/**
 * Structural equality for JSON-shaped values.
 *
 * Object keys compare as a set, so a value rebuilt by deleting and re-adding
 * keys still equals the original — comparing serialized JSON instead reports a
 * difference for key order alone. Arrays stay order-sensitive: port lists and
 * branches are ordered, and a reorder there is a real change.
 *
 * A key holding `undefined` counts as absent, matching what these values mean
 * once they reach the API as JSON.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (!isPlainRecord(a) || !isPlainRecord(b)) return false;
  const aKeys = definedKeys(a);
  const bKeys = definedKeys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const definedKeys = (value: Record<string, unknown>) =>
  Object.keys(value).filter((key) => value[key] !== undefined);
