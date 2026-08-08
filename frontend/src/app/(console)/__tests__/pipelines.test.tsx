import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PipelinesKindPage from "@/app/(console)/pipelines/[slug]/page";
import PipelinesPage from "@/app/(console)/pipelines/page";
import { PIPELINE_KIND_STORAGE_KEY } from "@/components/pipelines/lib/pipeline-kinds";
import { getMockRedirect, getMockRouter } from "@/test/test-utils";

vi.mock("@/components/pipelines/PipelineBuilder", () => ({
  PipelineBuilder: ({ kind }: { kind: string }) => <div data-testid="pipeline-builder">{kind}</div>,
}));

const noSearchParams = Promise.resolve({});

describe("pipelines pages", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("redirects to the saved pipeline kind's route", () => {
    window.localStorage.setItem(PIPELINE_KIND_STORAGE_KEY, "retrieval");
    render(<PipelinesPage />);

    expect(getMockRouter().replace).toHaveBeenCalledWith("/pipelines/tools");
    expect(screen.getByText(/Loading pipelines/)).toBeInTheDocument();
  });

  it("falls back to the first pipeline kind when invalid", () => {
    window.localStorage.setItem(PIPELINE_KIND_STORAGE_KEY, "invalid");
    render(<PipelinesPage />);

    expect(getMockRouter().replace).toHaveBeenCalledWith("/pipelines/ingestion");
  });

  it("renders the pipeline builder for valid slugs", async () => {
    const result = await PipelinesKindPage({
      params: Promise.resolve({ slug: "ingestion" }),
      searchParams: noSearchParams,
    });
    const { getByTestId } = render(result);
    expect(getByTestId("pipeline-builder")).toHaveTextContent("ingestion");
  });

  it("renders the retrieval builder at the tools slug", async () => {
    const result = await PipelinesKindPage({
      params: Promise.resolve({ slug: "tools" }),
      searchParams: noSearchParams,
    });
    const { getByTestId } = render(result);
    expect(getByTestId("pipeline-builder")).toHaveTextContent("retrieval");
  });

  it("redirects the retired retrieval slug, keeping the deep link", async () => {
    await expect(
      PipelinesKindPage({
        params: Promise.resolve({ slug: "retrieval" }),
        searchParams: Promise.resolve({ pipeline: "abc", node: "query-input" }),
      }),
    ).rejects.toThrow("Redirect: /pipelines/tools?pipeline=abc&node=query-input");
    expect(getMockRedirect()).toHaveBeenCalledWith(
      "/pipelines/tools?pipeline=abc&node=query-input",
    );
  });

  it("redirects to pipelines when the slug names no kind", async () => {
    await expect(
      PipelinesKindPage({ params: Promise.resolve({ slug: "bad" }), searchParams: noSearchParams }),
    ).rejects.toThrow("Redirect: /pipelines");
    expect(getMockRedirect()).toHaveBeenCalledWith("/pipelines");
  });
});
