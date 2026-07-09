import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineNodeLibrary } from "@/components/pipelines/PipelineNodeLibrary";

import type { NodeSpec } from "@/lib/types";

describe("PipelineNodeLibrary", () => {
  it("renders catalog entries and handles preview/drag", () => {
    const onPreviewNode = vi.fn();
    const catalog = [
      {
        family: "chunker" as const,
        specs: [
          {
            type: "chunker.token",
            label: "Token Chunker",
            category: "ingestion",
            description: "",
            example: "",
            input_ports: [],
            output_ports: [],
            config_schema: {},
            default_config: {},
            hidden: false,
          } satisfies NodeSpec,
        ],
      },
    ];

    render(<PipelineNodeLibrary catalog={catalog} onPreviewNode={onPreviewNode} />);

    fireEvent.click(screen.getByRole("button", { name: /Token Chunker/ }));
    expect(onPreviewNode).toHaveBeenCalledWith(catalog[0].specs[0]);

    const dataTransfer = { setData: vi.fn(), effectAllowed: "" } as unknown as DataTransfer;
    fireEvent.dragStart(screen.getByRole("button", { name: /Token Chunker/ }), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/ragworks-node", "chunker.token");
  });
});
