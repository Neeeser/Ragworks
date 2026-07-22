import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SearchFailurePanel } from "@/components/collections/detail/search/SearchFailurePanel";
import { getMockRouter } from "@/test/test-utils";

describe("SearchFailurePanel", () => {
  it("names the failed node and links to the run trace", async () => {
    render(
      <SearchFailurePanel
        message="ignored when structured"
        failure={{
          message: "Retrieval failed at Embedder: the model provider returned an error.",
          code: "retrieval_pipeline_failed",
          failed_node: { node_id: "embed", node_name: "Embedder", node_type: "embedder.text" },
          pipeline_run_id: "run-123",
        }}
      />,
    );
    expect(screen.getByText(/the model provider returned an error/)).toBeInTheDocument();
    expect(screen.getByText("Embedder")).toBeInTheDocument();
    expect(screen.getByText(/embedder\.text/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /View trace/ }));
    expect(getMockRouter().push).toHaveBeenCalledWith("/traces/runs/run-123");
  });

  it("falls back to the plain message when the failure is unstructured", () => {
    render(<SearchFailurePanel failure={null} message="Query failed." />);
    expect(screen.getByText("Query failed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View trace/ })).not.toBeInTheDocument();
  });
});
