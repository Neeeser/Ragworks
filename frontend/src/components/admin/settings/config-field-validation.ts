import type { ConfigFieldRead } from "@/lib/types";

/**
 * Whether an edited value is the same as the one already stored.
 *
 * Dirty state is what gates Save, so it has to be a claim about *values*:
 * tracking which keys were touched instead leaves a field dirty after the
 * user types over a value and puts the original back, and the only way out
 * is Discard — which throws away their other edits too.
 */
export function configValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return false;
}

/**
 * The reason a value cannot be saved, or `null` when it can.
 *
 * The catalog carries each field's own domain — `min_value`/`max_value` read
 * off the Pydantic `ge`/`le`, `options` for a constrained set — so this stays
 * a reading of the catalog rather than a second copy of the backend's rules.
 * The API validates too; catching it here is what turns a 400 with a
 * server-shaped message into a message beside the field that caused it.
 */
export function configFieldError(field: ConfigFieldRead, value: unknown): string | null {
  if (field.kind === "int") return intError(field, value);
  if (field.kind === "select") return selectError(field, value);
  if (field.kind === "multi_select") return multiSelectError(field, value);
  return null;
}

function intError(field: ConfigFieldRead, value: unknown): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) return "Enter a number.";
  if (!Number.isInteger(value)) return "Enter a whole number.";
  if (field.min_value != null && value < field.min_value) {
    return `Must be at least ${field.min_value}.`;
  }
  if (field.max_value != null && value > field.max_value) {
    return `Must be at most ${field.max_value}.`;
  }
  return null;
}

function selectError(field: ConfigFieldRead, value: unknown): string | null {
  const allowed = (field.options ?? []).map((option) => option.value);
  if (allowed.length === 0 || typeof value !== "string") return null;
  return allowed.includes(value) ? null : "Choose one of the listed values.";
}

function multiSelectError(field: ConfigFieldRead, value: unknown): string | null {
  const allowed = new Set((field.options ?? []).map((option) => option.value));
  if (allowed.size === 0 || !Array.isArray(value)) return null;
  const unknown = value.filter((item) => typeof item === "string" && !allowed.has(item));
  return unknown.length > 0 ? `Not a listed value: ${unknown.join(", ")}.` : null;
}
