import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImportBenchmarkDialog } from "@/components/evals/ImportBenchmarkDialog";

import type { BuiltinDatasetInfo } from "@/lib/types";

function makeBenchmark(overrides: Partial<BuiltinDatasetInfo> = {}): BuiltinDatasetInfo {
  return {
    key: "scifact",
    name: "SciFact",
    description: "Scientific claim verification.",
    domain: "Biomedical literature",
    measures: "Claim-style queries against dense scientific abstracts.",
    num_queries: 300,
    num_corpus_docs: 5183,
    modalities: ["text"],
    license_name: "CC BY-SA 4.0",
    approx_download_mb: 3,
    ...overrides,
  };
}

function renderDialog(benchmarks: BuiltinDatasetInfo[]) {
  render(
    <ImportBenchmarkDialog
      open
      benchmarks={benchmarks}
      importedKeys={new Set()}
      onImport={vi.fn(async () => true)}
      onClose={vi.fn()}
    />,
  );
}

describe("ImportBenchmarkDialog", () => {
  it("states the download size and licence beside the counts", () => {
    renderDialog([
      makeBenchmark({
        key: "vidore-economics-v2",
        name: "ViDoRe economics reports",
        num_queries: 58,
        num_corpus_docs: 452,
        license_name: "CC BY 3.0",
        approx_download_mb: 53,
        modalities: ["image"],
      }),
    ]);

    expect(screen.getByText(/58 queries · 452 docs · 53 MB download · CC BY 3\.0/)).toBeVisible();
  });

  it("marks a corpus that carries images and leaves a text corpus unmarked", () => {
    renderDialog([
      makeBenchmark(),
      makeBenchmark({ key: "vidore-economics-v2", name: "ViDoRe", modalities: ["image"] }),
    ]);

    // Text is every benchmark's baseline, so only the image corpus is badged.
    expect(screen.getAllByText("Images")).toHaveLength(1);
    expect(screen.queryByText("Text")).not.toBeInTheDocument();
  });
});
