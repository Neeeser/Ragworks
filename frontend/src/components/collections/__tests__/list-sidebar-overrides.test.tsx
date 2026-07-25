"use client";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionsList } from "@/components/collections/list/CollectionsList";
import { PipelineOverridesEditor } from "@/components/collections/PipelineOverridesEditor";
import { makeCollection, makeCollectionStats, makeNodeSpec, makePipeline } from "@/test/fixtures";
import { getMockRouter } from "@/test/test-utils";

import type { NodeSpec, Pipeline } from "@/lib/types";

vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

const NODE_TYPE = "node.type";
const NODE_EMPTY_TYPE = "node.empty";

describe("collections list and sidebar", () => {
  it("offers creation from the empty state", () => {
    const onCreateRequest = vi.fn();
    render(
      <CollectionsList
        collections={[]}
        statsById={{}}
        onDeleteRequest={() => {}}
        onCreateRequest={onCreateRequest}
      />,
    );
    expect(screen.getByText("No collections yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    expect(onCreateRequest).toHaveBeenCalled();
  });

  it("shows a skeleton at row geometry while loading", () => {
    render(
      <CollectionsList
        collections={[]}
        statsById={{}}
        loading
        onDeleteRequest={() => {}}
        onCreateRequest={() => {}}
      />,
    );
    // The loading state must not render the empty state — they mean different
    // things, and showing "No collections yet." mid-load reads as data loss.
    expect(screen.getByText("Loading collections")).toBeInTheDocument();
    expect(screen.queryByText("No collections yet.")).not.toBeInTheDocument();
  });

  it("renders collections and handles navigation and delete", () => {
    const onDeleteRequest = vi.fn();
    const collection = makeCollection({ name: "Collection", description: "  " });
    const stats = makeCollectionStats({
      document_count: 0,
      chunk_count: 0,
      average_latency_ms: null,
      last_used_at: null,
    });
    render(
      <CollectionsList
        collections={[collection]}
        statsById={{ [collection.id]: stats }}
        onDeleteRequest={onDeleteRequest}
        onCreateRequest={() => {}}
      />,
    );

    // The row navigates as a real link now, so it is keyboard-activatable and
    // middle-clickable without a synthetic key handler.
    expect(screen.getByRole("link", { name: /Collection/ })).toHaveAttribute(
      "href",
      "/collections/col-1",
    );

    fireEvent.click(screen.getByLabelText("Browse files in Collection"));
    expect(getMockRouter().push).toHaveBeenCalledWith("/collections/col-1/files");

    fireEvent.click(screen.getByLabelText("Delete Collection"));
    expect(onDeleteRequest).toHaveBeenCalledWith(collection);
  });

  it("renders latency and default stats when missing", () => {
    const collectionA = makeCollection({ id: "col-a", name: "Alpha" });
    const collectionB = makeCollection({ id: "col-b", name: "Beta" });
    const stats = makeCollectionStats({
      collection_id: "col-b",
      document_count: 2,
      chunk_count: 4,
      average_latency_ms: 120.4,
    });

    render(
      <CollectionsList
        collections={[collectionA, collectionB]}
        statsById={{ [collectionB.id]: stats }}
        onDeleteRequest={() => undefined}
        onCreateRequest={() => {}}
      />,
    );

    // A collection with no stats row shows an em-dash, never a misleading 0.
    const rows = screen.getAllByRole("link");
    expect(rows[0]).toHaveTextContent("Alpha");
    expect(rows[0]).toHaveTextContent("—");
    expect(rows[1]).toHaveTextContent("Beta");
    expect(rows[1]).toHaveTextContent("2");
    expect(rows[1]).toHaveTextContent("4");
  });
});

const makeOverridesNodeSpec = (overrides: Partial<NodeSpec>): NodeSpec =>
  makeNodeSpec({
    type: NODE_TYPE,
    label: "Node",
    category: "test",
    description: "",
    input_ports: [],
    output_ports: [],
    ...overrides,
  });

describe("PipelineOverridesEditor", () => {
  it("renders empty state without a pipeline", () => {
    render(
      <PipelineOverridesEditor
        title="Overrides"
        pipeline={null}
        nodeSpecs={[]}
        overrides={{}}
        onOverridesChange={() => {}}
      />,
    );
    expect(screen.getByText("Select a pipeline to configure overrides.")).toBeInTheDocument();
  });

  it("handles config edits and nullable values", () => {
    const onOverridesChange = vi.fn();
    const pipeline = makePipeline({
      id: "pipe-1",
      name: "Pipeline",
      kind: "ingestion",
      definition: {
        nodes: [{ id: "node-1", type: NODE_TYPE, name: "Node", config: { count: 2 } }],
        edges: [],
      },
    });
    const nodeSpecs: NodeSpec[] = [
      makeOverridesNodeSpec({
        config_schema: {
          properties: {
            count: { type: "integer", default: 1 },
            enabled: { type: "boolean" },
            note: { type: ["string", "null"] },
          },
        },
      }),
    ];

    render(
      <PipelineOverridesEditor
        title="Overrides"
        pipeline={pipeline}
        nodeSpecs={nodeSpecs}
        overrides={{}}
        onOverridesChange={onOverridesChange}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });

    const calls = onOverridesChange.mock.calls.map(
      ([value]) => value as Record<string, Record<string, unknown>>,
    );
    expect(calls.some((call) => call["node-1"]?.count === 3)).toBe(true);

    const lastCall = calls.at(-1);
    expect(lastCall?.["node-1"]?.note).toBeUndefined();
  });

  it("clears invalid numeric values and nullable text", () => {
    const onOverridesChange = vi.fn();
    const pipeline = makePipeline({
      id: "pipe-nan",
      name: "Pipeline",
      kind: "retrieval",
      definition: {
        nodes: [
          {
            id: "node-nan",
            type: NODE_TYPE,
            name: "Node",
            config: { threshold: 0.2, note: "keep" },
          },
        ],
        edges: [],
      },
    });
    const nodeSpecs: NodeSpec[] = [
      makeOverridesNodeSpec({
        config_schema: {
          properties: {
            threshold: { type: "number" },
            note: { type: ["string", "null"] },
          },
        },
      }),
    ];

    render(
      <PipelineOverridesEditor
        title="Overrides"
        pipeline={pipeline}
        nodeSpecs={nodeSpecs}
        overrides={{}}
        onOverridesChange={onOverridesChange}
      />,
    );

    const numberInput = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "NaN" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });

    const calls = onOverridesChange.mock.calls.map(
      ([value]) => value as Record<string, Record<string, unknown>>,
    );
    const clearedThreshold = calls.some((call) => !("threshold" in (call["node-nan"] ?? {})));
    const clearedNote = calls.some((call) => !("note" in (call["node-nan"] ?? {})));
    expect(clearedThreshold).toBe(true);
    expect(clearedNote).toBe(true);
  });

  it("handles numeric parsing edge cases and required fields", () => {
    const onOverridesChange = vi.fn();
    const pipeline = makePipeline({
      id: "pipe-2",
      name: "Pipeline",
      kind: "retrieval",
      definition: {
        nodes: [{ id: "node-2", type: NODE_TYPE, name: "Node Two", config: { ratio: 1.25 } }],
        edges: [],
      },
    });
    const nodeSpecs: NodeSpec[] = [
      makeOverridesNodeSpec({
        config_schema: {
          required: ["required_text"],
          properties: {
            ratio: { type: "number", default: 0.5 },
            count: { type: "integer", default: 1 },
            note: { type: ["string", "null"] },
            required_text: { type: "string" },
          },
        },
      }),
    ];

    render(
      <PipelineOverridesEditor
        title="Overrides"
        pipeline={pipeline}
        nodeSpecs={nodeSpecs}
        overrides={{}}
        onOverridesChange={onOverridesChange}
      />,
    );

    const [ratioInput, countInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(ratioInput, { target: { value: "" } });
    fireEvent.change(ratioInput, { target: { value: "NaN" } });
    fireEvent.change(ratioInput, { target: { value: "abc" } });
    fireEvent.change(ratioInput, { target: { value: "2.5" } });
    fireEvent.change(countInput, { target: { value: "3.7" } });

    // The two text fields (note, then required_text) are the only textboxes rendered,
    // in schema-property order.
    const [noteInput, requiredInput] = screen.getAllByRole("textbox");
    fireEvent.change(noteInput, { target: { value: "note" } });
    fireEvent.change(noteInput, { target: { value: "" } });
    fireEvent.change(requiredInput, { target: { value: "required" } });

    const calls = onOverridesChange.mock.calls.map(
      ([value]) => value as Record<string, Record<string, unknown>>,
    );
    const hasCount = calls.some((call) => call["node-2"]?.count === 3);
    const hasRequiredText = calls.some((call) => call["node-2"]?.required_text === "required");
    const hasRemovedNote = calls.some((call) => !("note" in (call["node-2"] ?? {})));
    expect(hasCount).toBe(true);
    expect(hasRequiredText).toBe(true);
    expect(hasRemovedNote).toBe(true);
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("skips nodes without config fields", () => {
    const pipeline = makePipeline({
      id: "pipe-3",
      name: "Pipeline",
      kind: "retrieval",
      definition: {
        nodes: [{ id: "node-3", type: NODE_EMPTY_TYPE, name: "Empty", config: {} }],
        edges: [],
      },
    });
    const nodeSpecs: NodeSpec[] = [
      makeOverridesNodeSpec({ type: NODE_EMPTY_TYPE, label: "Empty", config_schema: {} }),
    ];

    render(
      <PipelineOverridesEditor
        title="Overrides"
        pipeline={pipeline}
        nodeSpecs={nodeSpecs}
        overrides={{}}
        onOverridesChange={() => {}}
      />,
    );

    expect(screen.queryByText("Empty")).not.toBeInTheDocument();
  });

  it("skips nodes without schemas and merges null configs", () => {
    const pipeline: Pipeline = makePipeline({
      id: "pipe-null",
      name: "Pipeline",
      kind: "ingestion",
      definition: {
        nodes: [
          {
            id: "node-schema",
            type: "node.schema",
            name: "Node With Schema",
            // Deliberately malformed to exercise the component's null-config guard.
            config: null as unknown as Record<string, unknown>,
          },
          { id: "node-empty", type: NODE_EMPTY_TYPE, name: "Node Without Schema", config: {} },
        ],
        edges: [],
      },
    });
    const nodeSpecs: NodeSpec[] = [
      makeOverridesNodeSpec({
        type: "node.schema",
        config_schema: { properties: { foo: { type: "string", default: "default" } } },
        default_config: { foo: "default" },
      }),
      makeOverridesNodeSpec({ type: NODE_EMPTY_TYPE, config_schema: {} }),
    ];

    render(
      <PipelineOverridesEditor
        title="Overrides"
        pipeline={pipeline}
        nodeSpecs={nodeSpecs}
        overrides={{}}
        onOverridesChange={() => undefined}
      />,
    );

    expect(screen.getByDisplayValue("default")).toBeInTheDocument();
    expect(screen.queryByText("Node Without Schema")).not.toBeInTheDocument();
  });
});
