/**
 * Builtin function catalog, mirroring `app/pipelines/expressions/functions.py`.
 * `round` rounds half away from zero (2.5 -> 3, -2.5 -> -3) so both
 * implementations agree; the shared vectors pin this.
 */

import { evalError } from "./errors";

export interface BuiltinSpec {
  name: string;
  minArgs: number;
  maxArgs: number | null;
  result: "preserve_int" | "always_int";
  apply: (args: number[]) => number;
}

function roundHalfAway(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
}

function clamp(args: number[]): number {
  const [value, low, high] = args;
  if (low > high) {
    throw evalError(`clamp() range is inverted: ${low} > ${high}`);
  }
  return Math.min(Math.max(value, low), high);
}

export const BUILTINS: Record<string, BuiltinSpec> = {
  min: {
    name: "min",
    minArgs: 2,
    maxArgs: null,
    result: "preserve_int",
    apply: (args) => Math.min(...args),
  },
  max: {
    name: "max",
    minArgs: 2,
    maxArgs: null,
    result: "preserve_int",
    apply: (args) => Math.max(...args),
  },
  clamp: { name: "clamp", minArgs: 3, maxArgs: 3, result: "preserve_int", apply: clamp },
  floor: {
    name: "floor",
    minArgs: 1,
    maxArgs: 1,
    result: "always_int",
    apply: (args) => Math.floor(args[0]),
  },
  ceil: {
    name: "ceil",
    minArgs: 1,
    maxArgs: 1,
    result: "always_int",
    apply: (args) => Math.ceil(args[0]),
  },
  round: {
    name: "round",
    minArgs: 1,
    maxArgs: 1,
    result: "always_int",
    apply: (args) => roundHalfAway(args[0]),
  },
};

export function arityMessage(spec: BuiltinSpec, received: number): string {
  let expected: string;
  if (spec.maxArgs === null) {
    expected = `at least ${spec.minArgs} arguments`;
  } else if (spec.minArgs === spec.maxArgs) {
    expected = `exactly ${spec.minArgs} argument${spec.minArgs === 1 ? "" : "s"}`;
  } else {
    expected = `${spec.minArgs} to ${spec.maxArgs} arguments`;
  }
  return `${spec.name}() takes ${expected}, got ${received}`;
}
