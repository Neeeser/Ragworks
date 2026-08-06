import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NodeExplanation } from "@/components/traces/explanations/NodeExplanation";
import { makeNodeRunTrace } from "@/test/fixtures";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { TraceStep } from "@/components/traces/trace-graph";
import type { PipelineNodeSummary, TraceFocusedItem } from "@/lib/types";
import type { Node } from "@xyflow/react";

const FOCUSED_TEXT = "Focused text";
const PARSE_TEXT = "parse.text";
const IO_TIMESTAMP = "2024-01-01T00:00:00Z";
const PARSE_MEDIA = "parse.embedded_media";
const PDF_TYPE = "application/pdf";
const FIGURES_PATH = "collections/c/files/solar-figures.pdf";
const OPEN_TEXT_BUTTON = "Open extracted text";
const IMAGE_RESIZE = "image.resize";
const IMAGE_TILE = "image.tile";
const IMAGE_PNG = "image/png";
const ITEMS_LABEL = "Items";
const IMAGES_LABEL = "Images";
const JSON_KIND = "json" as const;
const PASSED_THROUGH = "Passed through";

const OVERSIZE_DIMENSIONS = ["2000x1500", "1200x900"];
const FITTED_DIMENSIONS = ["1568x1176", "1200x900"];
const SMALL_DIMENSIONS = ["800x600", "640x480"];
const RESIZED_LABEL = "Resized";
const TILES_LABEL = "Tiles";
const NO_IMAGES_LINE = "No image items reached this step.";
const DEFAULT_BOX = "1568×1568";
const TILE_BOX = "1024×1024";
const TILE_DIMENSIONS = ["1024x1024"];

/** The `image_summary` shape both image transform ports report. */
const imageStream = (count: number, dimensions: string[]) => ({
  count,
  media_types: [IMAGE_PNG],
  dimensions,
});

const integerField = (defaultValue: number) => ({ type: "integer", default: defaultValue });

/** The config schemas the two image transform nodes publish. */
const RESIZE_SCHEMA = {
  properties: { max_width: integerField(1568), max_height: integerField(1568) },
};
const TILE_SCHEMA = {
  properties: {
    tile_width: integerField(1024),
    tile_height: integerField(1024),
    overlap: integerField(0),
  },
};

const makeStep = (
  nodeType: string,
  summary: PipelineNodeSummary,
  io: TraceStep["io"] = { inputs: [], outputs: [] },
): TraceStep => ({
  nodeId: "node",
  nodeIds: ["node"],
  run: makeNodeRunTrace({ node_id: "node", node_type: nodeType, summary }),
  io,
  stage: nodeType.startsWith("retriev") || nodeType.startsWith("fusion") ? "retrieval" : "origin",
  stageLabel: "Stage",
});

const makeNode = (
  nodeType: string,
  config: Record<string, unknown> = {},
  configSchema?: Record<string, unknown>,
): Node<PipelineNodeData> => ({
  id: "node",
  type: "pipelineNode",
  position: { x: 0, y: 0 },
  data: {
    label: "Node",
    nodeType,
    description: "Description",
    inputs: [],
    outputs: [],
    config,
    configSchema,
  },
});

/** A step and its node, with the props the image transform cases never vary. */
const renderExplanation = (step: TraceStep, node: Node<PipelineNodeData>) =>
  render(
    <NodeExplanation
      step={step}
      node={node}
      focusedItemId={null}
      contextItems={[]}
      itemEffect={null}
      inputSources={[]}
    />,
  );

const contextItem = (index: number, text: string): TraceFocusedItem => ({
  id: `doc:${index}`,
  status: "resolved",
  text,
  document_id: "doc",
  filename: "guide.md",
  chunk_index: index,
  chunk_count: 5,
});

describe("NodeExplanation", () => {
  it("shows the parsed file flowing into extracted text", () => {
    const parsedText = "# Guide\nParsed content with the complete normalized document.";
    const onOpenArtifact = vi.fn();
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Files",
          kind: "json",
          value: {
            count: 1,
            media_types: ["text/markdown"],
            paths: ["/uploads/guide.md"],
            byte_size: 2048,
          },
        },
      ],
      outputs: [
        {
          label: "Items",
          kind: "json",
          value: {
            count: 1,
            text: { preview: "# Guide\nParsed content", length: parsedText.length },
          },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep(PARSE_TEXT, summary, {
          inputs: [],
          outputs: [
            {
              id: "io-output",
              run_id: "run",
              node_run_id: "node-run",
              node_id: "node",
              io_type: "output",
              port: "items",
              payload: { document: { document_id: "doc", text: parsedText } },
              created_at: IO_TIMESTAMP,
              updated_at: IO_TIMESTAMP,
            },
          ],
        })}
        node={makeNode(PARSE_TEXT)}
        focusedItemId={null}
        contextItems={[{ ...contextItem(0, "Chunk context"), filename: "logical-name.md" }]}
        itemEffect={null}
        inputSources={[]}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    expect(screen.getByText("/uploads/guide.md")).toBeInTheDocument();
    expect(screen.getByText(/text\/markdown · 2,048 bytes/)).toBeInTheDocument();
    expect(screen.getByText("# Guide Parsed content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: OPEN_TEXT_BUTTON }));
    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ text: parsedText, filename: "logical-name.md · Extracted text" }),
    );
  });

  it("offers the extracted text of a document trace opened without a chunk", () => {
    // Opening a document trace from the Files page resolves no context items;
    // the full text is still the artifact the trace exists to show.
    const parsedText = "Full parsed body of the report.";
    const onOpenArtifact = vi.fn();
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Files",
          kind: "json",
          value: {
            count: 1,
            media_types: [PDF_TYPE],
            paths: ["documents/9f2c/report.pdf"],
            byte_size: 4096,
          },
        },
      ],
      outputs: [
        {
          label: "Items",
          kind: "json",
          value: { count: 1, text: { preview: "Full parsed", length: parsedText.length } },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep(PARSE_TEXT, summary, {
          inputs: [],
          outputs: [
            {
              id: "io-output",
              run_id: "run",
              node_run_id: "node-run",
              node_id: "node",
              io_type: "output",
              port: "items",
              payload: { document: { document_id: "doc", text: parsedText } },
              created_at: IO_TIMESTAMP,
              updated_at: IO_TIMESTAMP,
            },
          ],
        })}
        node={makeNode(PARSE_TEXT)}
        focusedItemId={null}
        contextItems={[]}
        itemEffect={null}
        inputSources={[]}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: OPEN_TEXT_BUTTON }));
    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ text: parsedText, filename: "report.pdf · Extracted text" }),
    );
  });

  it("states that a file with no text layer produced nothing, beside the file it read", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Files",
          kind: "json",
          value: {
            count: 1,
            media_types: [PDF_TYPE],
            paths: [FIGURES_PATH],
            byte_size: 88_320,
          },
        },
      ],
      outputs: [{ label: "Items", kind: "json", value: { count: 0, text: null } }],
    };

    render(
      <NodeExplanation
        step={makeStep(PARSE_TEXT, summary)}
        node={makeNode(PARSE_TEXT)}
        focusedItemId={null}
        contextItems={[]}
        itemEffect={null}
        inputSources={[]}
      />,
    );

    expect(screen.getByText(FIGURES_PATH)).toBeInTheDocument();
    expect(screen.getByText(/88,320 bytes/)).toBeInTheDocument();
    expect(
      screen.getByText("The file carries no text layer, so this step emitted no text items."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: OPEN_TEXT_BUTTON })).not.toBeInTheDocument();
  });

  it("names the content type a parse step had no handler for", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Files",
          kind: "json",
          value: {
            count: 1,
            media_types: ["image/png"],
            paths: ["collections/c/files/diagram.png"],
            byte_size: 4_096,
          },
        },
      ],
      outputs: [
        { label: "Items", kind: "json", value: { count: 0, text: null } },
        { label: "Unread files", kind: "json", value: { count: 1, media_types: ["image/png"] } },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep(PARSE_TEXT, summary)}
        node={makeNode(PARSE_TEXT)}
        focusedItemId={null}
        contextItems={[]}
        itemEffect={null}
        inputSources={[]}
      />,
    );

    expect(
      screen.getByText("This step has no handler for image/png, so it read nothing."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no text layer/)).not.toBeInTheDocument();
  });

  it("summarizes the images an extract-media step pulled out of the file", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Files",
          kind: "json",
          value: {
            count: 1,
            media_types: [PDF_TYPE],
            paths: [FIGURES_PATH],
            byte_size: 88_320,
          },
        },
      ],
      outputs: [
        {
          label: "Items",
          kind: "json",
          value: { count: 2, media_types: ["image/png"], dimensions: ["1024x768", "800x600"] },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep(PARSE_MEDIA, summary)}
        node={makeNode(PARSE_MEDIA, { min_width: 64, min_height: 64 })}
        focusedItemId={null}
        contextItems={[]}
        itemEffect={null}
        inputSources={[]}
      />,
    );

    expect(screen.getByText("Pulled 2 images out of the file.")).toBeInTheDocument();
    expect(screen.getByText("2 images")).toBeInTheDocument();
    expect(screen.getByText("image/png")).toBeInTheDocument();
    expect(screen.getByText("1024x768, 800x600")).toBeInTheDocument();
  });

  it("names the size filter when an extract-media step found no embedded images", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Files",
          kind: "json",
          value: {
            count: 1,
            media_types: [PDF_TYPE],
            paths: ["collections/c/files/notes.pdf"],
            byte_size: 512,
          },
        },
      ],
      outputs: [
        { label: "Items", kind: "json", value: { count: 0, media_types: [], dimensions: [] } },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep(PARSE_MEDIA, summary)}
        node={makeNode(PARSE_MEDIA, { min_width: 64, min_height: 64 })}
        focusedItemId={null}
        contextItems={[]}
        itemEffect={null}
        inputSources={[]}
      />,
    );

    expect(
      screen.getByText("The file carries no embedded images at least 64\u00d764 pixels."),
    ).toBeInTheDocument();
  });

  it("counts what a resize step rewrote, what already fitted, and what it warned about", () => {
    const warning = "Could not read page-3.png as an image; passed through unchanged.";
    const summary: PipelineNodeSummary = {
      inputs: [
        { label: IMAGES_LABEL, kind: JSON_KIND, value: imageStream(3, OVERSIZE_DIMENSIONS) },
        { label: PASSED_THROUGH, kind: JSON_KIND, value: { count: 2, facets: { text: 2 } } },
      ],
      outputs: [
        { label: ITEMS_LABEL, kind: JSON_KIND, value: imageStream(3, FITTED_DIMENSIONS) },
        {
          label: RESIZED_LABEL,
          kind: JSON_KIND,
          value: { resized: 2, unchanged: 1, unreadable: 0 },
        },
        { label: "Warnings", kind: JSON_KIND, value: [warning] },
      ],
    };

    renderExplanation(
      makeStep(IMAGE_RESIZE, summary),
      makeNode(IMAGE_RESIZE, { max_width: 1568, max_height: 1568 }, RESIZE_SCHEMA),
    );

    expect(
      screen.getByText(
        "Resized 2 images to fit within 1568×1568 pixels. 1 image already fitted and passed through.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_BOX)).toBeInTheDocument();
    expect(screen.getByText(PASSED_THROUGH)).toBeInTheDocument();
    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it("reports an image it could not read as unread, not as already fitted", () => {
    const warning = "Could not read the image on 'doc-1:page:0' — passed through unchanged.";
    const summary: PipelineNodeSummary = {
      inputs: [{ label: IMAGES_LABEL, kind: JSON_KIND, value: imageStream(1, []) }],
      outputs: [
        { label: ITEMS_LABEL, kind: JSON_KIND, value: imageStream(1, []) },
        {
          label: RESIZED_LABEL,
          kind: JSON_KIND,
          value: { resized: 0, unchanged: 0, unreadable: 1 },
        },
        { label: "Warnings", kind: JSON_KIND, value: [warning] },
      ],
    };

    renderExplanation(makeStep(IMAGE_RESIZE, summary), makeNode(IMAGE_RESIZE, {}, RESIZE_SCHEMA));

    expect(
      screen.getByText("1 image could not be read and passed through unchanged."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/already fitted/)).toBeNull();
    expect(screen.getByText("Unreadable")).toBeInTheDocument();
    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it("states the size limit a scaffolded resize node runs on from its schema default", () => {
    const summary: PipelineNodeSummary = {
      inputs: [{ label: IMAGES_LABEL, kind: JSON_KIND, value: imageStream(4, SMALL_DIMENSIONS) }],
      outputs: [
        { label: ITEMS_LABEL, kind: JSON_KIND, value: imageStream(4, SMALL_DIMENSIONS) },
        {
          label: RESIZED_LABEL,
          kind: JSON_KIND,
          value: { resized: 0, unchanged: 4, unreadable: 0 },
        },
      ],
    };

    // The wizard scaffolds this node with an empty config, and a config patch
    // only carries the fields the user edited.
    renderExplanation(makeStep(IMAGE_RESIZE, summary), makeNode(IMAGE_RESIZE, {}, RESIZE_SCHEMA));

    expect(
      screen.getByText(
        "4 images already fitted within 1568×1568 pixels, so nothing was rewritten.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_BOX)).toBeInTheDocument();
    expect(screen.queryByText(PASSED_THROUGH)).not.toBeInTheDocument();
  });

  it("keeps the schema default for the resize field the user left alone", () => {
    const summary: PipelineNodeSummary = {
      inputs: [{ label: IMAGES_LABEL, kind: JSON_KIND, value: imageStream(1, SMALL_DIMENSIONS) }],
      outputs: [
        {
          label: RESIZED_LABEL,
          kind: JSON_KIND,
          value: { resized: 1, unchanged: 0, unreadable: 0 },
        },
      ],
    };

    renderExplanation(
      makeStep(IMAGE_RESIZE, summary),
      makeNode(IMAGE_RESIZE, { max_width: 2000 }, RESIZE_SCHEMA),
    );

    expect(screen.getByText("2000×1568")).toBeInTheDocument();
    expect(screen.getByText("Resized 1 image to fit within 2000×1568 pixels.")).toBeInTheDocument();
  });

  it("names the limit rather than a number when a resize field holds an expression", () => {
    const summary: PipelineNodeSummary = {
      inputs: [{ label: IMAGES_LABEL, kind: JSON_KIND, value: imageStream(2, SMALL_DIMENSIONS) }],
      outputs: [
        {
          label: RESIZED_LABEL,
          kind: JSON_KIND,
          value: { resized: 0, unchanged: 2, unreadable: 0 },
        },
      ],
    };

    renderExplanation(
      makeStep(IMAGE_RESIZE, summary),
      makeNode(IMAGE_RESIZE, { max_width: { $expr: "args.width" } }, RESIZE_SCHEMA),
    );

    expect(
      screen.getByText(
        "2 images already fitted within the maximum size, so nothing was rewritten.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_BOX)).toBeNull();
  });

  it("states that no images reached a resize step", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        { label: PASSED_THROUGH, kind: JSON_KIND, value: { count: 3, facets: { text: 3 } } },
      ],
      outputs: [
        {
          label: RESIZED_LABEL,
          kind: JSON_KIND,
          value: { resized: 0, unchanged: 0, unreadable: 0 },
        },
      ],
    };

    renderExplanation(makeStep(IMAGE_RESIZE, summary), makeNode(IMAGE_RESIZE, {}, RESIZE_SCHEMA));

    expect(screen.getByText(NO_IMAGES_LINE)).toBeInTheDocument();
  });

  it("reports the grid when a tile step split exactly one image", () => {
    const summary: PipelineNodeSummary = {
      inputs: [{ label: IMAGES_LABEL, kind: JSON_KIND, value: imageStream(1, ["3000x4000"]) }],
      outputs: [
        { label: ITEMS_LABEL, kind: JSON_KIND, value: imageStream(12, TILE_DIMENSIONS) },
        {
          label: TILES_LABEL,
          kind: JSON_KIND,
          value: { sources: 1, tiles: 12, unchanged: 0, unreadable: 0, grid: "3x4" },
        },
      ],
    };

    renderExplanation(
      makeStep(IMAGE_TILE, summary),
      makeNode(IMAGE_TILE, { tile_width: 1024, tile_height: 1024, overlap: 64 }, TILE_SCHEMA),
    );

    expect(
      screen.getByText("Split 1 image into 12 tiles no larger than 1024×1024 pixels."),
    ).toBeInTheDocument();
    expect(screen.getByText("Grid (columns × rows)")).toBeInTheDocument();
    expect(screen.getByText("3x4")).toBeInTheDocument();
    expect(screen.getByText("64")).toBeInTheDocument();
  });

  it("accounts for the images a tile step left in one tile, and reports no run-wide grid", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        { label: IMAGES_LABEL, kind: JSON_KIND, value: imageStream(5, ["3000x2000", "800x600"]) },
      ],
      outputs: [
        { label: ITEMS_LABEL, kind: JSON_KIND, value: imageStream(11, TILE_DIMENSIONS) },
        {
          label: TILES_LABEL,
          kind: JSON_KIND,
          value: { sources: 2, tiles: 8, unchanged: 3, unreadable: 0 },
        },
      ],
    };

    // An unedited tile node runs on its schema defaults, same as resize.
    renderExplanation(makeStep(IMAGE_TILE, summary), makeNode(IMAGE_TILE, {}, TILE_SCHEMA));

    expect(
      screen.getByText(
        "Split 2 images into 8 tiles no larger than 1024×1024 pixels. " +
          "3 images fitted in one tile and passed through.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(TILE_BOX)).toBeInTheDocument();
    expect(screen.queryByText(/Grid/)).toBeNull();
  });

  it("never presents one image's grid as the whole run's", () => {
    const summary: PipelineNodeSummary = {
      inputs: [{ label: IMAGES_LABEL, kind: JSON_KIND, value: imageStream(2, ["3000x2000"]) }],
      outputs: [
        { label: ITEMS_LABEL, kind: JSON_KIND, value: imageStream(12, TILE_DIMENSIONS) },
        // A trace recorded before the grid was scoped to a single source
        // carries the grid of the last image it tiled.
        { label: TILES_LABEL, kind: JSON_KIND, value: { sources: 2, tiles: 12, grid: "3x4" } },
      ],
    };

    renderExplanation(makeStep(IMAGE_TILE, summary), makeNode(IMAGE_TILE, {}, TILE_SCHEMA));

    expect(screen.queryByText(/Grid/)).toBeNull();
    expect(screen.queryByText("3x4")).toBeNull();
  });

  it("states that every image fitted one tile when a tile step split nothing", () => {
    const summary: PipelineNodeSummary = {
      inputs: [{ label: IMAGES_LABEL, kind: JSON_KIND, value: imageStream(3, SMALL_DIMENSIONS) }],
      outputs: [
        { label: ITEMS_LABEL, kind: JSON_KIND, value: imageStream(3, SMALL_DIMENSIONS) },
        {
          label: TILES_LABEL,
          kind: JSON_KIND,
          value: { sources: 0, tiles: 0, unchanged: 3, unreadable: 0 },
        },
      ],
    };

    renderExplanation(
      makeStep(IMAGE_TILE, summary),
      makeNode(IMAGE_TILE, { tile_width: 1024, tile_height: 1024, overlap: 0 }, TILE_SCHEMA),
    );

    expect(
      screen.getByText("3 images fitted in one tile of 1024×1024 pixels, so nothing was split."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Grid/)).toBeNull();
  });

  it("states that no images reached a tile step", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        { label: PASSED_THROUGH, kind: JSON_KIND, value: { count: 2, facets: { text: 2 } } },
      ],
      outputs: [
        {
          label: TILES_LABEL,
          kind: JSON_KIND,
          value: { sources: 0, tiles: 0, unchanged: 0, unreadable: 0 },
        },
      ],
    };

    renderExplanation(makeStep(IMAGE_TILE, summary), makeNode(IMAGE_TILE, {}, TILE_SCHEMA));

    expect(screen.getByText(NO_IMAGES_LINE)).toBeInTheDocument();
  });

  it("renders a focused chunk between its real neighbors", () => {
    const summary: PipelineNodeSummary = {
      inputs: [],
      outputs: [
        {
          label: "Chunk items",
          kind: "items",
          value: {
            kind: "chunks",
            items: [0, 1, 2, 3, 4].map((index) => ({ id: `doc:${index}`, score: null })),
          },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep("chunker.token", summary)}
        node={makeNode("chunker.token", { chunk_size: 128, chunk_overlap: 16 })}
        focusedItemId="doc:2"
        contextItems={[
          contextItem(0, "Zero"),
          contextItem(1, "One"),
          contextItem(2, "Two"),
          contextItem(3, "Three"),
          contextItem(4, "Four"),
        ]}
        itemEffect={null}
        inputSources={[]}
      />,
    );

    const neighborhood = screen.getByRole("list", { name: "Chunk neighborhood" });
    expect(
      within(neighborhood)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("Zero"),
      expect.stringContaining("One"),
      expect.stringContaining("Two"),
      expect.stringContaining("Three"),
      expect.stringContaining("Four"),
    ]);
    const focusedRow = within(neighborhood)
      .getByRole("button", { name: "Inspect result doc:2" })
      .closest("li");
    expect(focusedRow).toHaveAttribute("aria-current", "true");
  });

  it("keeps retrieval order stable and only changes trace focus explicitly", () => {
    const ids = ["doc:0", "doc:1", "doc:2", "doc:3"];
    const summary: PipelineNodeSummary = {
      inputs: [],
      outputs: [
        {
          label: "Match items",
          kind: "items",
          value: { kind: "matches", items: ids.map((id, index) => ({ id, score: 20 - index })) },
        },
      ],
    };
    const onFocusItem = vi.fn();
    const onOpenArtifact = vi.fn();
    const firstContext = contextItem(1, "Chunk 1");

    render(
      <NodeExplanation
        step={makeStep("retriever.bm25", summary)}
        node={makeNode("retriever.bm25")}
        focusedItemId="doc:2"
        contextItems={[firstContext, contextItem(2, "Chunk 2")]}
        itemEffect={null}
        inputSources={[]}
        onFocusItem={onFocusItem}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    expect(screen.getByText("BM25 score")).toBeInTheDocument();
    const ranking = screen.getByRole("list", { name: "BM25 ranking" });
    expect(
      within(ranking)
        .getAllByRole("button", { name: /Inspect result/ })
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(ids.map((id) => `Inspect result ${id}`));

    fireEvent.click(screen.getByRole("button", { name: "Inspect result doc:1" }));
    expect(onFocusItem).not.toHaveBeenCalled();
    expect(screen.getAllByText("Chunk 1")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open chunk" }));
    expect(onOpenArtifact).toHaveBeenCalledWith(firstContext);
    fireEvent.click(screen.getByRole("button", { name: "Trace result guide.md · Chunk 2" }));
    expect(onFocusItem).toHaveBeenCalledWith("doc:1");
  });

  it("expands a fused result into proportional source contributions", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Branch 1 items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 0.7 }] },
        },
        {
          label: "Branch 2 items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 12.4 }] },
        },
      ],
      outputs: [
        {
          label: "Matches",
          value: {
            count: 1,
            top_matches: [
              {
                rank: 1,
                chunk_id: "doc:2",
                document_id: "doc",
                score: 0.032,
                preview: "## Focused **text** for pg_search ranking",
              },
            ],
          },
        },
        {
          label: "Fused items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 0.032 }] },
        },
        {
          label: "Ranking evidence",
          kind: "ranking",
          value: {
            method: "reciprocal_rank_fusion",
            score_label: "RRF score",
            formula: "1 / (60 + rank)",
            results: [
              {
                id: "doc:2",
                rank: 1,
                score: 0.032,
                sources: [
                  { source_index: 0, rank: 3, score: 0.7, contribution: 0.01587 },
                  { source_index: 1, rank: 7, score: 12.4, contribution: 0.01493 },
                ],
              },
            ],
          },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep("fusion.rrf", summary)}
        node={makeNode("fusion.rrf", { k: 60 })}
        focusedItemId="doc:2"
        contextItems={[]}
        itemEffect={null}
        inputSources={["Semantic Retriever", "BM25 Retriever"]}
      />,
    );

    expect(screen.getByRole("button", { name: "Inspect result doc:2" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Focused text for pg_search ranking")).toBeInTheDocument();
    expect(screen.getByText("Vector similarity · 0.7000")).toBeInTheDocument();
    expect(screen.getByText("BM25 score · 12.400")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Semantic Retriever contribution" }),
    ).toHaveAttribute("aria-valuenow", "52");
    expect(
      screen.getByRole("progressbar", { name: "BM25 Retriever contribution" }),
    ).toHaveAttribute("aria-valuenow", "48");
    expect(screen.getByText("Fused ranking")).toBeInTheDocument();
    expect(screen.getByText(/1 \/ \(60 \+ rank\)/)).toBeInTheDocument();
    expect(screen.queryByText("Native score")).not.toBeInTheDocument();
  });

  it("preserves the upstream score method at retrieval output", () => {
    const summary: PipelineNodeSummary = {
      inputs: [],
      outputs: [
        {
          label: "Result items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 0.032 }] },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep("retrieval.output", summary)}
        node={makeNode("retrieval.output")}
        focusedItemId="doc:2"
        contextItems={[contextItem(2, FOCUSED_TEXT)]}
        itemEffect={null}
        inputSources={["RRF Fusion"]}
      />,
    );

    expect(screen.getByText("RRF score")).toBeInTheDocument();
  });

  it("labels provider-backed reranking scores without naming an implementation", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Input items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 0.032 }] },
        },
      ],
      outputs: [
        {
          label: "Output items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 0.9948 }] },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep("reranker.model", summary)}
        node={makeNode("reranker.model")}
        focusedItemId={null}
        contextItems={[contextItem(2, FOCUSED_TEXT)]}
        itemEffect={null}
        inputSources={["RRF Fusion"]}
      />,
    );

    expect(screen.getByText("Reranker score")).toBeInTheDocument();
    expect(screen.queryByText("Cross-encoder score")).not.toBeInTheDocument();
  });
});
