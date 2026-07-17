import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExpressionInput, evaluateExpressionFeedback } from "../ExpressionInput";
import { buildStaticEnvironment } from "../lib/variable-env";

import type { PipelineInputArgument } from "@/lib/types";

const TOP_K: PipelineInputArgument = { name: "top_k", type: "integer", default: 5 };

const env = buildStaticEnvironment(
  [TOP_K],
  [{ name: "emb", type: "model", value: { connection_id: "c-1", model_name: "mini" } }],
);

describe("evaluateExpressionFeedback", () => {
  it("previews a valid expression against argument defaults", () => {
    const feedback = evaluateExpressionFeedback("top_k * 2", env, { expectedType: "integer" });
    expect(feedback).toEqual({ kind: "ok", type: "integer", preview: "10" });
  });

  it("accepts integer expressions where a number is expected", () => {
    const feedback = evaluateExpressionFeedback("top_k + 1", env, { expectedType: "number" });
    expect(feedback.kind).toBe("ok");
  });

  it("rejects a type mismatch against the field's type", () => {
    const feedback = evaluateExpressionFeedback("'ten'", env, { expectedType: "integer" });
    expect(feedback).toMatchObject({ kind: "error", message: "Expected integer, got string." });
  });

  it("enforces the static-only rule against caller input", () => {
    const feedback = evaluateExpressionFeedback("top_k * 2", env, {
      expectedType: "integer",
      staticOnly: true,
    });
    expect(feedback.kind).toBe("error");
    expect((feedback as { message: string }).message).toMatch(/caller input \(top_k\)/);
  });

  it("requires dereferencing a bare model value", () => {
    const feedback = evaluateExpressionFeedback("emb", env, {});
    expect((feedback as { message: string }).message).toMatch(/\.connection_id/);
  });

  it("surfaces syntax errors", () => {
    const feedback = evaluateExpressionFeedback("top_k *", env, {});
    expect(feedback.kind).toBe("error");
  });
});

describe("ExpressionInput", () => {
  it("shows the live preview for a valid expression", () => {
    render(
      <ExpressionInput
        aria-label="Top K expression"
        value="min(top_k * 3, 12)"
        onChange={() => undefined}
        env={env}
        expectedType="integer"
      />,
    );
    expect(screen.getByText("= 12")).toBeInTheDocument();
  });

  it("marks the input invalid and shows the message on errors", () => {
    render(
      <ExpressionInput
        aria-label="Top K expression"
        value="missing + 1"
        onChange={() => undefined}
        env={env}
      />,
    );
    expect(screen.getByLabelText("Top K expression")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Unknown variable 'missing'/)).toBeInTheDocument();
  });
});
