import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiagnosticItem } from "@/components/collections/detail/diagnostics/DiagnosticItem";
import { makeDiagnostic } from "@/test/fixtures";

describe("DiagnosticItem", () => {
  it("renders severity, code, confidence, title, summary, and paired observations", () => {
    render(<DiagnosticItem diagnostic={makeDiagnostic()} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("embedding_model_mismatch")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Embedding models differ")).toBeInTheDocument();
    expect(
      screen.getByText("Ingestion and retrieval use different embedding models."),
    ).toBeInTheDocument();
    expect(screen.getByText("ingest")).toBeInTheDocument();
    expect(screen.getByText("model-a")).toBeInTheDocument();
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.getByText("model-b")).toBeInTheDocument();
  });

  it("renders a single-value observation with its label", () => {
    const diagnostic = makeDiagnostic({
      observations: [{ label: "Indexed chunks", value: "0" }],
    });
    render(<DiagnosticItem diagnostic={diagnostic} />);
    expect(screen.getByText("Indexed chunks")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("links the action to its route", () => {
    render(<DiagnosticItem diagnostic={makeDiagnostic()} />);
    expect(screen.getByRole("link", { name: /Edit retrieval pipeline/ })).toHaveAttribute(
      "href",
      "/pipelines/retrieval",
    );
  });

  it("links every related route the finding carries", () => {
    const diagnostic = makeDiagnostic({
      action: null,
      links: [{ label: "Run abc", route: "/traces/runs/abc", kind: "trace" }],
    });
    render(<DiagnosticItem diagnostic={diagnostic} />);
    expect(screen.getByRole("link", { name: /Run abc/ })).toHaveAttribute(
      "href",
      "/traces/runs/abc",
    );
  });
});
