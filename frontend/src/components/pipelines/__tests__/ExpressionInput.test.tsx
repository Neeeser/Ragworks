import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExpressionInput, evaluateExpressionFeedback } from "../ExpressionInput";
import { buildStaticEnvironment } from "../lib/variable-env";

import type { PipelineVariable } from "@/lib/types";

const TOP_K: PipelineVariable = { name: "top_k", type: "integer", source: "input", value: 5 };

const EXPRESSION_LABEL = "Top K expression";
const SUGGESTIONS = "Expression suggestions";

const env = buildStaticEnvironment([
  TOP_K,
  { name: "emb", type: "model", value: { connection_id: "c-1", model_name: "mini" } },
]);

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
        aria-label={EXPRESSION_LABEL}
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
        aria-label={EXPRESSION_LABEL}
        value="missing + 1"
        onChange={() => undefined}
        env={env}
      />,
    );
    expect(screen.getByLabelText(EXPRESSION_LABEL)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Unknown variable 'missing'/)).toBeInTheDocument();
  });

  it("opens the suggestion listbox on focus and inserts the picked variable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ExpressionInput aria-label={EXPRESSION_LABEL} value="" onChange={onChange} env={env} />,
    );
    await user.click(screen.getByLabelText(EXPRESSION_LABEL));
    const listbox = screen.getByRole("listbox", { name: SUGGESTIONS });
    expect(listbox).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /top_k/ }));
    expect(onChange).toHaveBeenCalledWith("top_k");
  });

  it("filters against the typed token and accepts with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ExpressionInput aria-label={EXPRESSION_LABEL} value="ma" onChange={onChange} env={env} />,
    );
    const input = screen.getByLabelText(EXPRESSION_LABEL);
    await user.click(input);
    expect(screen.queryByRole("option", { name: /top_k/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /max/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("max()");
  });

  it("Escape closes only the suggestion listbox and does not bubble", async () => {
    const user = userEvent.setup();
    const outerEscape = vi.fn();
    render(
      <div onKeyDown={(event) => event.key === "Escape" && outerEscape()}>
        <ExpressionInput
          aria-label={EXPRESSION_LABEL}
          value=""
          onChange={() => undefined}
          env={env}
        />
      </div>,
    );
    await user.click(screen.getByLabelText(EXPRESSION_LABEL));
    expect(screen.getByRole("listbox", { name: SUGGESTIONS })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: SUGGESTIONS })).not.toBeInTheDocument();
    expect(outerEscape).not.toHaveBeenCalled();
  });
});
