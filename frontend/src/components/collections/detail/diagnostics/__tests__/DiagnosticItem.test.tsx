import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DiagnosticItem } from "@/components/collections/detail/diagnostics/DiagnosticItem";
import { makeDiagnostic } from "@/test/fixtures";
import { getMockRouter } from "@/test/test-utils";

describe("DiagnosticItem", () => {
  it("renders title, summary, and paired observations", () => {
    render(<DiagnosticItem diagnostic={makeDiagnostic()} />);
    expect(screen.getByText("Embedding models differ")).toBeInTheDocument();
    expect(screen.getByText(/ingest: model-a/)).toBeInTheDocument();
    expect(screen.getByText(/query: model-b/)).toBeInTheDocument();
  });

  it("navigates to the action route when the action button is clicked", async () => {
    render(<DiagnosticItem diagnostic={makeDiagnostic()} />);
    await userEvent.click(screen.getByRole("button", { name: /Edit retrieval pipeline/ }));
    expect(getMockRouter().push).toHaveBeenCalledWith("/pipelines/retrieval");
  });

  it("renders trace links and navigates on click", async () => {
    const diagnostic = makeDiagnostic({
      action: null,
      links: [{ label: "Run abc", route: "/traces/runs/abc", kind: "trace" }],
    });
    render(<DiagnosticItem diagnostic={diagnostic} />);
    await userEvent.click(screen.getByRole("button", { name: /Run abc/ }));
    expect(getMockRouter().push).toHaveBeenCalledWith("/traces/runs/abc");
  });
});
