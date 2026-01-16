import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PipelinesKindPage from "@/app/(console)/pipelines/[kind]/page";
import PipelinesPage from "@/app/(console)/pipelines/page";
import { PIPELINE_KIND_STORAGE_KEY } from "@/components/pipelines/pipeline-kinds";
import { getMockRedirect, getMockRouter } from "@/test/test-utils";

vi.mock("@/components/pipelines/PipelineBuilder", () => ({
  PipelineBuilder: ({ kind }: { kind: string }) => <div data-testid="pipeline-builder">{kind}</div>,
}));

describe("pipelines pages", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("redirects to the saved pipeline kind", () => {
    window.localStorage.setItem(PIPELINE_KIND_STORAGE_KEY, "retrieval");
    render(<PipelinesPage />);

    expect(getMockRouter().replace).toHaveBeenCalledWith("/pipelines/retrieval");
    expect(screen.getByText(/Loading pipelines/)).toBeInTheDocument();
  });

  it("falls back to the first pipeline kind when invalid", () => {
    window.localStorage.setItem(PIPELINE_KIND_STORAGE_KEY, "invalid");
    render(<PipelinesPage />);

    expect(getMockRouter().replace).toHaveBeenCalledWith("/pipelines/ingestion");
  });

  it("renders the pipeline builder for valid kinds", async () => {
    const result = await PipelinesKindPage({
      params: Promise.resolve({ kind: "ingestion" }),
    });
    const { getByTestId } = render(result);
    expect(getByTestId("pipeline-builder")).toHaveTextContent("ingestion");
  });

  it("redirects to pipelines when kind is invalid", async () => {
    await expect(PipelinesKindPage({ params: Promise.resolve({ kind: "bad" }) })).rejects.toThrow(
      "Redirect: /pipelines",
    );
    expect(getMockRedirect()).toHaveBeenCalledWith("/pipelines");
  });
});
