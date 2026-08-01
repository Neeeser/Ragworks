import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CollectionInsights } from "@/components/collections/detail/visualize/CollectionInsights";
import * as apiModule from "@/lib/api";
import { makeInsightSnapshot } from "@/test/fixtures";

import type { InsightOverview } from "@/lib/types";
import type { ReactNode } from "react";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

vi.mock("@/components/collections/detail/visualize/InsightMapCanvas", () => ({
  InsightMapCanvas: () => <div data-testid="map-canvas" />,
}));

vi.mock("@/components/collections/detail/visualize/GraphCanvas", () => ({
  GraphCanvas: () => <div data-testid="graph-canvas" />,
}));

vi.mock("next/dynamic", () => ({
  default: (loader: unknown, options?: { loading?: () => ReactNode }) => {
    if (typeof loader === "function") {
      void (loader as () => Promise<unknown>)().catch(() => undefined);
    }
    return ({ ...props }: Record<string, unknown>) => {
      void props;
      void options;
      return <div data-testid="dynamic-canvas" />;
    };
  },
}));

function overview(overrides: Partial<InsightOverview> = {}): InsightOverview {
  return {
    snapshot: makeInsightSnapshot(),
    active: null,
    chunk_total: 4,
    can_compute: true,
    ...overrides,
  };
}

describe("CollectionInsights", () => {
  it("serves the map by default and switches to the overlap report", async () => {
    api.fetchInsightOverview.mockResolvedValue(overview());
    api.fetchInsightOverlaps.mockResolvedValue({
      snapshot: makeInsightSnapshot(),
      pairs: [
        {
          similarity: 0.973,
          a: {
            chunk_id: "c-1",
            document_id: "d-1",
            document_name: "faq-v1.txt",
            chunk_index: 2,
            text_snippet: "refund window is thirty days",
          },
          b: {
            chunk_id: "c-2",
            document_id: "d-2",
            document_name: "faq-v2.txt",
            chunk_index: 5,
            text_snippet: "the refund window is 30 days",
          },
        },
      ],
    });

    await act(async () => {
      render(<CollectionInsights collectionId="col-1" token="token" />);
    });

    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Insight view" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Overlaps" }));

    await waitFor(() => {
      expect(screen.getByText("faq-v1.txt")).toBeInTheDocument();
    });
    expect(screen.getByText("faq-v2.txt")).toBeInTheDocument();
    expect(screen.getByText("0.973")).toBeInTheDocument();
  });

  it("kicks off the first build when chunks exist but no snapshot does", async () => {
    api.fetchInsightOverview.mockResolvedValue(
      overview({ snapshot: null, can_compute: true, chunk_total: 12 }),
    );
    api.refreshInsights.mockResolvedValue(
      overview({
        snapshot: null,
        active: makeInsightSnapshot({ status: "computing" }),
      }),
    );

    await act(async () => {
      render(<CollectionInsights collectionId="col-1" token="token" />);
    });

    await waitFor(() => {
      expect(api.refreshInsights).toHaveBeenCalledWith("token", "col-1");
    });
    expect(screen.getByText(/Computing the first snapshot/)).toBeInTheDocument();
  });

  it("explains what is missing when the collection cannot compute yet", async () => {
    api.fetchInsightOverview.mockResolvedValue(
      overview({ snapshot: null, can_compute: false, chunk_total: 1 }),
    );

    await act(async () => {
      render(<CollectionInsights collectionId="col-1" token="token" />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Ingest at least three chunks/)).toBeInTheDocument();
    });
    expect(api.refreshInsights).not.toHaveBeenCalled();
  });
});
