"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreateCollectionWizard } from "@/components/collections/list/CreateCollectionWizard";

import type { Collection, NodeSpec, Pipeline } from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";

const api = {
  createCollection: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  createCollection: (...args: unknown[]) => api.createCollection(...args),
}));

let overridesByTitle: Record<string, Record<string, Record<string, unknown>>> = {};

vi.mock("@/components/collections/PipelineOverridesEditor", () => ({
  PipelineOverridesEditor: ({
    title,
    overrides,
  }: {
    title: string;
    overrides: Record<string, Record<string, unknown>>;
  }) => {
    overridesByTitle = { ...overridesByTitle, [title]: overrides };
    return <div data-testid="overrides-editor">{title}</div>;
  },
}));

describe("CreateCollectionWizard", () => {
  const ingestion: Pipeline = {
    id: "ing-1",
    user_id: "user-1",
    name: "Ingestion",
    kind: "ingestion",
    current_version: 1,
    is_default: true,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
    definition: {
      nodes: [{ id: "node-1", type: "node.type", name: "Node", config: {} }],
      edges: [],
    },
  };
  const retrieval: Pipeline = {
    id: "ret-1",
    user_id: "user-1",
    name: "Retrieval",
    kind: "retrieval",
    current_version: 1,
    is_default: true,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
    definition: {
      nodes: [{ id: "node-2", type: "node.type", name: "Node", config: {} }],
      edges: [],
    },
  };
  const nodeSpecs: NodeSpec[] = [
    {
      type: "node.type",
      label: "Node",
      description: "",
      config_schema: { properties: { foo: { type: "string" } } },
      input_ports: [],
      output_ports: [],
    },
  ];

  beforeEach(() => {
    overridesByTitle = {};
  });

  it("returns null when closed", () => {
    const { container } = render(
      <CreateCollectionWizard
        open={false}
        token="token"
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        nodeSpecs={nodeSpecs}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("walks through steps and creates a collection", async () => {
    const created: Collection = {
      id: "col-1",
      user_id: "user-1",
      name: "Collection",
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    };
    const onCreated = vi.fn();
    const onClose = vi.fn();
    api.createCollection.mockResolvedValueOnce(created);

    render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        nodeSpecs={nodeSpecs}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Research vault"), {
      target: { value: "Collection" },
    });
    fireEvent.change(screen.getByPlaceholderText("Summarize what this collection is for."), {
      target: { value: "Notes" },
    });
    fireEvent.click(screen.getByText("Next"));

    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "ret-1" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Show"));
    expect(screen.getAllByTestId("overrides-editor").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Next"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    });

    await waitFor(() => {
      expect(api.createCollection).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onClose).toHaveBeenCalled();
  });

  it("builds default overrides when advanced options are opened", async () => {
    const ingestionWithDefaults: Pipeline = {
      ...ingestion,
      definition: {
        nodes: [
          {
            id: "node-1",
            type: "node.type",
            name: "Node",
            config: { foo: "override" },
          },
        ],
        edges: [],
      },
    };
    const retrievalWithDefaults: Pipeline = {
      ...retrieval,
      definition: {
        nodes: [
          {
            id: "node-2",
            type: "node.type",
            name: "Node",
            config: { foo: "override" },
          },
        ],
        edges: [],
      },
    };
    const advancedSpecs: NodeSpec[] = [
      {
        type: "node.type",
        label: "Node",
        description: "",
        config_schema: {
          properties: {
            foo: { type: "string", default: "default" },
            bar: { type: "number", default: 2 },
          },
        },
        default_config: { foo: "default", bar: 2 },
        input_ports: [],
        output_ports: [],
      },
    ];

    render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[ingestionWithDefaults]}
        retrievalPipelines={[retrievalWithDefaults]}
        nodeSpecs={advancedSpecs}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Research vault"), {
      target: { value: "Collection" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));

    fireEvent.click(screen.getByText("Show"));

    await waitFor(() => {
      expect(overridesByTitle["Ingestion defaults"]).toEqual({
        "node-1": { foo: "override", bar: 2 },
      });
      expect(overridesByTitle["Retrieval defaults"]).toEqual({
        "node-2": { foo: "override", bar: 2 },
      });
    });
  });

  it("closes on escape", () => {
    const onClose = vi.fn();
    render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        nodeSpecs={nodeSpecs}
        onClose={onClose}
        onCreated={() => {}}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows loading options and review defaults when pipelines are missing", () => {
    render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[]}
        retrievalPipelines={[]}
        nodeSpecs={[]}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Pipelines/ }));
    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveTextContent("Loading pipelines...");
    expect(selects[1]).toHaveTextContent("Loading pipelines...");

    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText("No description provided.")).toBeInTheDocument();
    expect(screen.getAllByText("Default").length).toBeGreaterThan(0);
  });

  it("fills pipeline defaults when pipelines load after opening", () => {
    const { rerender } = render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[]}
        retrievalPipelines={[]}
        nodeSpecs={[]}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Pipelines/ }));

    rerender(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        nodeSpecs={nodeSpecs}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveValue("ing-1");
    expect(selects[1]).toHaveValue("ret-1");
  });

  it("shows node settings loader when advanced defaults are enabled", () => {
    render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        nodeSpecs={[]}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Defaults/ }));
    fireEvent.click(screen.getByText("Show"));
    expect(screen.getByText("Loading node settings...")).toBeInTheDocument();
  });

  it("builds overrides from default pipelines", () => {
    const overridePipeline = {
      ...ingestion,
      definition: {
        nodes: [
          {
            id: "node-override",
            type: "node.type",
            name: "Node",
            config: { foo: "bar" },
          },
        ],
        edges: [],
      },
    };
    const specsWithDefaults: NodeSpec[] = [
      {
        ...nodeSpecs[0],
        config_schema: { properties: { foo: { type: "string" } } },
        default_config: { foo: "default", bar: "from-default" },
      },
    ];

    render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[overridePipeline]}
        retrievalPipelines={[retrieval]}
        nodeSpecs={specsWithDefaults}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Defaults/ }));
    fireEvent.click(screen.getByText("Show"));

    expect(overridesByTitle["Ingestion defaults"]?.["node-override"]).toEqual({
      bar: "from-default",
      foo: "bar",
    });
  });

  it("uses the first pipeline when defaults are missing", () => {
    const firstIngestion = { ...ingestion, id: "ing-2", is_default: false };
    const firstRetrieval = { ...retrieval, id: "ret-2", is_default: false };
    render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[firstIngestion]}
        retrievalPipelines={[firstRetrieval]}
        nodeSpecs={nodeSpecs}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Pipelines/ }));
    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveValue("ing-2");
    expect(selects[1]).toHaveValue("ret-2");
  });

  it("shows errors when create fails and advanced options are unavailable", async () => {
    api.createCollection.mockRejectedValueOnce(new Error("Unable to create collection."));
    const nonDefault = { ...ingestion, id: "ing-2", is_default: false };
    render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[ingestion, nonDefault]}
        retrievalPipelines={[retrieval]}
        nodeSpecs={[]}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Research vault"), {
      target: { value: "Collection" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "ing-2" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Show"));
    expect(
      screen.getByText(
        "Advanced options are available only when the default pipelines are selected.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Unable to create collection.")).toBeInTheDocument();
    });
  });

  it("handles non-error create failures", async () => {
    api.createCollection.mockRejectedValueOnce("Create failed");
    render(
      <CreateCollectionWizard
        open
        token="token"
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        nodeSpecs={nodeSpecs}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Research vault"), {
      target: { value: "Collection" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Unable to create collection.")).toBeInTheDocument();
    });
  });
});
