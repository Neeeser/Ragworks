/**
 * Runs the shared conformance vectors (`tests/assets/expression_vectors.json`
 * at the repo root) — the same file the backend suite executes — so the two
 * expression implementations cannot drift.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkType, evaluate, parse } from "..";
import { ExpressionError } from "../errors";

import type { ExprType, ExprValue } from "../values";

interface VectorEnvEntry {
  type: ExprType;
  value: unknown;
}

interface VectorCase {
  name: string;
  source: string;
  env: Record<string, VectorEnvEntry>;
  expect?: { type: ExprType; value: unknown };
  error?: "syntax" | "type" | "eval";
}

// Vitest runs with cwd = frontend/, so the repo-root vectors live one level up.
const VECTORS_PATH = path.resolve(process.cwd(), "../tests/assets/expression_vectors.json");
const CASES: VectorCase[] = JSON.parse(readFileSync(VECTORS_PATH, "utf-8")).cases;

function typeEnv(env: Record<string, VectorEnvEntry>): Map<string, ExprType> {
  return new Map(Object.entries(env).map(([name, entry]) => [name, entry.type]));
}

function valueEnv(env: Record<string, VectorEnvEntry>): Map<string, ExprValue> {
  return new Map(Object.entries(env).map(([name, entry]) => [name, entry.value as ExprValue]));
}

function expectKind(fn: () => unknown, kind: "syntax" | "type" | "eval"): void {
  let thrown: unknown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ExpressionError);
  expect((thrown as ExpressionError).kind).toBe(kind);
}

describe("expression conformance vectors", () => {
  for (const vector of CASES) {
    it(vector.name, () => {
      if (vector.error === "syntax") {
        expectKind(() => parse(vector.source), "syntax");
        return;
      }
      const expr = parse(vector.source);
      if (vector.error === "type") {
        expectKind(() => checkType(expr, typeEnv(vector.env)), "type");
        return;
      }
      const resultType = checkType(expr, typeEnv(vector.env));
      if (vector.error === "eval") {
        expectKind(() => evaluate(expr, valueEnv(vector.env)), "eval");
        return;
      }
      const expected = vector.expect;
      if (!expected) throw new Error(`Vector ${vector.name} has no expectation`);
      expect(resultType).toBe(expected.type);
      const result = evaluate(expr, valueEnv(vector.env));
      if (resultType === "integer" || resultType === "number") {
        expect(typeof result).toBe("number");
        expect(result as number).toBeCloseTo(expected.value as number, 9);
        if (resultType === "integer") {
          expect(Number.isInteger(result)).toBe(true);
        }
      } else {
        expect(result).toEqual(expected.value);
      }
    });
  }
});
