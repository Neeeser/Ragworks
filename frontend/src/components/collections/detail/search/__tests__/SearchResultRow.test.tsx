import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchResultRow } from "@/components/collections/detail/search/SearchResultRow";
import { fetchCollectionAssetBlob } from "@/lib/api";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

describe("SearchResultRow", () => {
  it("renders an image match's asset alongside its text", async () => {
    global.URL.createObjectURL = vi.fn(() => "blob:asset");
    global.URL.revokeObjectURL = vi.fn();

    await act(async () => {
      render(
        <ul>
          <SearchResultRow
            chunk={{
              chunk_id: "doc:img:0",
              text: "[image: galaxy.jpg]",
              score: 0.9,
              metadata: {
                filename: "galaxy.jpg",
                "ragworks.image_asset": {
                  media_type: "image/jpeg",
                  path: "collections/c1/derived/d1/galaxy.jpg",
                  width: 640,
                  height: 480,
                },
              },
            }}
            rank={1}
            topScore={0.9}
            token="token"
            collectionId="c1"
          />
        </ul>,
      );
    });

    expect(vi.mocked(fetchCollectionAssetBlob)).toHaveBeenCalledWith(
      "token",
      "c1",
      "collections/c1/derived/d1/galaxy.jpg",
    );
    const image = await screen.findByRole("img", { name: /galaxy.jpg/ });
    expect(image).toHaveAttribute("src", "blob:asset");
  });

  it("renders no image element for a text-only match", async () => {
    await act(async () => {
      render(
        <ul>
          <SearchResultRow
            chunk={{ chunk_id: "doc:0", text: "prose", score: 0.5, metadata: {} }}
            rank={1}
            topScore={0.5}
            token="token"
            collectionId="c1"
          />
        </ul>,
      );
    });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
