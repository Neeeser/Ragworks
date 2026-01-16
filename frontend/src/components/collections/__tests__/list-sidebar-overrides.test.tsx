"use client";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionSidebar } from "@/components/collections/detail/CollectionSidebar";
import { CollectionsList } from "@/components/collections/list/CollectionsList";
import { PipelineOverridesEditor } from "@/components/collections/PipelineOverridesEditor";
import { getMockRouter } from "@/test/test-utils";

import type { Collection, CollectionStats, NodeSpec, Pipeline } from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";

describe("collections list and sidebar", () => {
  it("shows empty list message", () => {
    render(<CollectionsList collections={[]} statsById={{}} onDeleteRequest={() => {}} />);
    expect(
      screen.getByText("No collections yet. Create one to start indexing documents."),
    ).toBeInTheDocument();
  });

  it("renders collections and handles navigation and delete", () => {
    const onDeleteRequest = vi.fn();
    const collection: Collection = {
      id: "col-1",
      user_id: "user-1",
      name: "Collection",
      description: "  ",
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    };
    const stats: CollectionStats = {
      collection_id: "col-1",
      document_count: 0,
      chunk_count: 0,
      average_latency_ms: null,
      last_used_at: null,
    };
    render(
      <CollectionsList
        collections={[collection]}
        statsById={{ [collection.id]: stats }}
        onDeleteRequest={onDeleteRequest}
      />,
    );

    const card = screen.getAllByRole("button", { name: /Collection/ })[0];
    fireEvent.click(card);
    expect(getMockRouter().push).toHaveBeenCalledWith("/collections/col-1");

    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });

    fireEvent.click(screen.getByLabelText("Delete Collection"));
    expect(onDeleteRequest).toHaveBeenCalledWith(collection);
    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
  });

  it("renders latency and default stats when missing", () => {
    const collectionA: Collection = {
      id: "col-a",
      user_id: "user-1",
      name: "Alpha",
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    };
    const collectionB: Collection = {
      id: "col-b",
      user_id: "user-1",
      name: "Beta",
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    };
    const stats: CollectionStats = {
      collection_id: "col-b",
      document_count: 2,
      chunk_count: 4,
      average_latency_ms: 120.4,
      last_used_at: baseTimestamp,
    };

    render(
      <CollectionsList
        collections={[collectionA, collectionB]}
        statsById={{ [collectionB.id]: stats }}
        onDeleteRequest={() => undefined}
      />,
    );

    expect(screen.getByText("120 ms")).toBeInTheDocument();
  });

  it("renders the sidebar and handles actions", () => {
    const onSelectView = vi.fn();
    const collection: Collection = {
      id: "col-1",
      user_id: "user-1",
      name: "Collection",
      description: "Primary collection",
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    };
    const { rerender } = render(
      <CollectionSidebar
        collection={collection}
        activeView="overview"
        onSelectView={onSelectView}
      />,
    );

    fireEvent.click(screen.getByText("Back to collections"));
    expect(getMockRouter().push).toHaveBeenCalledWith("/collections");
    fireEvent.click(screen.getByText("Search"));
    expect(onSelectView).toHaveBeenCalledWith("search");
    fireEvent.click(screen.getByText("Chat studio"));
    expect(getMockRouter().push).toHaveBeenCalledWith("/chat?collections=col-1");

    rerender(
      <CollectionSidebar collection={null} activeView="overview" onSelectView={onSelectView} />,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
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
    const pipeline: Pipeline = {
      id: "pipe-1",
      user_id: "user-1",
      name: "Pipeline",
      kind: "ingestion",
      current_version: 1,
      is_default: false,
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
      definition: {
        nodes: [
          {
            id: "node-1",
            type: "node.type",
            name: "Node",
            config: { count: 2 },
          },
        ],
        edges: [],
      },
    };
    const nodeSpecs: NodeSpec[] = [
      {
        type: "node.type",
        label: "Node",
        description: "",
        config_schema: {
          properties: {
            count: { type: "integer", default: 1 },
            enabled: { type: "boolean" },
            note: { type: ["string", "null"] },
          },
        },
        input_ports: [],
        output_ports: [],
      },
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
    const pipeline: Pipeline = {
      id: "pipe-nan",
      user_id: "user-1",
      name: "Pipeline",
      kind: "retrieval",
      current_version: 1,
      is_default: false,
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
      definition: {
        nodes: [
          {
            id: "node-nan",
            type: "node.type",
            name: "Node",
            config: { threshold: 0.2, note: "keep" },
          },
        ],
        edges: [],
      },
    };
    const nodeSpecs: NodeSpec[] = [
      {
        type: "node.type",
        label: "Node",
        description: "",
        config_schema: {
          properties: {
            threshold: { type: "number" },
            note: { type: ["string", "null"] },
          },
        },
        input_ports: [],
        output_ports: [],
      },
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
    const pipeline: Pipeline = {
      id: "pipe-2",
      user_id: "user-1",
      name: "Pipeline",
      kind: "retrieval",
      current_version: 1,
      is_default: false,
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
      definition: {
        nodes: [
          {
            id: "node-2",
            type: "node.type",
            name: "Node Two",
            config: { ratio: 1.25 },
          },
        ],
        edges: [],
      },
    };
    const nodeSpecs: NodeSpec[] = [
      {
        type: "node.type",
        label: "Node",
        description: "",
        config_schema: {
          required: ["required_text"],
          properties: {
            ratio: { type: "number", default: 0.5 },
            count: { type: "integer", default: 1 },
            note: { type: ["string", "null"] },
            required_text: { type: "string" },
          },
        },
        input_ports: [],
        output_ports: [],
      },
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

    const noteCard = screen.getByText("Note").closest("div.rounded-2xl");
    const requiredCard = screen.getByText("Required Text").closest("div.rounded-2xl");
    if (!noteCard || !requiredCard) {
      throw new Error("Expected config cards for note and required text");
    }
    const noteInput = noteCard.querySelector("input");
    const requiredInput = requiredCard.querySelector("input");
    if (!noteInput || !requiredInput) {
      throw new Error("Expected config inputs for note and required text");
    }

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
    const pipeline: Pipeline = {
      id: "pipe-3",
      user_id: "user-1",
      name: "Pipeline",
      kind: "retrieval",
      current_version: 1,
      is_default: false,
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
      definition: {
        nodes: [
          {
            id: "node-3",
            type: "node.empty",
            name: "Empty",
            config: {},
          },
        ],
        edges: [],
      },
    };
    const nodeSpecs: NodeSpec[] = [
      {
        type: "node.empty",
        label: "Empty",
        description: "",
        config_schema: {},
        input_ports: [],
        output_ports: [],
      },
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
    const pipeline: Pipeline = {
      id: "pipe-null",
      user_id: "user-1",
      name: "Pipeline",
      kind: "ingestion",
      current_version: 1,
      is_default: false,
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
      definition: {
        nodes: [
          {
            id: "node-schema",
            type: "node.schema",
            name: "Node With Schema",
            config: null,
          },
          {
            id: "node-empty",
            type: "node.empty",
            name: "Node Without Schema",
            config: {},
          },
        ],
        edges: [],
      },
    };
    const nodeSpecs: NodeSpec[] = [
      {
        type: "node.schema",
        label: "Node",
        description: "",
        config_schema: {
          properties: {
            foo: { type: "string", default: "default" },
          },
        },
        default_config: { foo: "default" },
        input_ports: [],
        output_ports: [],
      },
      {
        type: "node.empty",
        label: "Node",
        description: "",
        input_ports: [],
        output_ports: [],
      },
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
