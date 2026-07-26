"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateCollectionWizard } from "@/components/collections/list/CreateCollectionWizard";
import * as apiModule from "@/lib/api";
import { makeCollection, makeNodeSpec, makePipeline } from "@/test/fixtures";

import type { NodeSpec, Pipeline } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
// The pipelines step renders the index slots, whose inline create reads the
// deployment's default backend from the public config.
vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

const api = vi.mocked(apiModule);

const namePlaceholder = "Research vault";
const descriptionPlaceholder = "Summarize what this collection is for.";
const createButtonLabel = "Create collection";
const ingestionDefaultsTitle = "Ingestion defaults";
const retrievalDefaultsTitle = "Retrieval defaults";
const createFailedMessage = "Unable to create collection.";
const advancedUnavailableMessage =
  "Advanced options are available only when the default pipelines are selected.";

type OverridesState = Record<string, Record<string, unknown>>;

let overridesByTitle: Record<string, OverridesState> = {};
let overridesChangeByTitle: Record<string, (next: OverridesState) => void> = {};

vi.mock("@/components/collections/PipelineOverridesEditor", () => ({
  PipelineOverridesEditor: ({
    title,
    overrides,
    onOverridesChange,
  }: {
    title: string;
    overrides: OverridesState;
    onOverridesChange: (next: OverridesState) => void;
  }) => {
    overridesByTitle = { ...overridesByTitle, [title]: overrides };
    overridesChangeByTitle = { ...overridesChangeByTitle, [title]: onOverridesChange };
    return <div data-testid="overrides-editor">{title}</div>;
  },
}));

describe("CreateCollectionWizard", () => {
  const ingestion = makePipeline({
    id: "ing-1",
    name: "Ingestion",
    kind: "ingestion",
    is_default: true,
    definition: {
      nodes: [{ id: "node-1", type: "node.type", name: "Node", config: {} }],
      edges: [],
    },
  });
  const retrieval = makePipeline({
    id: "ret-1",
    name: "Retrieval",
    kind: "retrieval",
    is_default: true,
    definition: {
      nodes: [{ id: "node-2", type: "node.type", name: "Node", config: {} }],
      edges: [],
    },
  });
  const nodeSpecs: NodeSpec[] = [
    makeNodeSpec({
      type: "node.type",
      label: "Node",
      category: "test",
      description: "",
      config_schema: { properties: { foo: { type: "string" } } },
      default_config: {},
      input_ports: [],
      output_ports: [],
    }),
  ];

  beforeEach(() => {
    overridesByTitle = {};
    overridesChangeByTitle = {};
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
    const user = userEvent.setup();
    const created = makeCollection();
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

    await user.type(screen.getByPlaceholderText(namePlaceholder), "Collection");
    await user.type(screen.getByPlaceholderText(descriptionPlaceholder), "Notes");
    await user.click(screen.getByText("Next"));

    await user.selectOptions(screen.getAllByRole("combobox")[1], "ret-1");
    await user.click(screen.getByText("Next"));
    await user.click(screen.getByText("Show"));
    expect(screen.getAllByTestId("overrides-editor").length).toBeGreaterThan(0);
    await user.click(screen.getByText("Next"));

    await user.click(screen.getByRole("button", { name: createButtonLabel }));

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
        nodes: [{ id: "node-1", type: "node.type", name: "Node", config: { foo: "override" } }],
        edges: [],
      },
    };
    const retrievalWithDefaults: Pipeline = {
      ...retrieval,
      definition: {
        nodes: [{ id: "node-2", type: "node.type", name: "Node", config: { foo: "override" } }],
        edges: [],
      },
    };
    const advancedSpecs: NodeSpec[] = [
      makeNodeSpec({
        ...nodeSpecs[0],
        config_schema: {
          properties: {
            foo: { type: "string", default: "default" },
            bar: { type: "number", default: 2 },
          },
        },
        default_config: { foo: "default", bar: 2 },
      }),
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

    fireEvent.change(screen.getByPlaceholderText(namePlaceholder), {
      target: { value: "Collection" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));

    fireEvent.click(screen.getByText("Show"));

    await waitFor(() => {
      expect(overridesByTitle[ingestionDefaultsTitle]).toEqual({
        "node-1": { foo: "override", bar: 2 },
      });
      expect(overridesByTitle[retrievalDefaultsTitle]).toEqual({
        "node-2": { foo: "override", bar: 2 },
      });
    });
  });

  it("seeds full node configs when pipelines resolve after Advanced is expanded, so an edit submits the whole config", async () => {
    const ingestionWithDefaults: Pipeline = {
      ...ingestion,
      definition: {
        nodes: [{ id: "node-1", type: "node.type", name: "Node", config: { foo: "override" } }],
        edges: [],
      },
    };
    const retrievalWithDefaults: Pipeline = {
      ...retrieval,
      definition: {
        nodes: [{ id: "node-2", type: "node.type", name: "Node", config: { foo: "override" } }],
        edges: [],
      },
    };
    const advancedSpecs: NodeSpec[] = [
      makeNodeSpec({
        ...nodeSpecs[0],
        config_schema: {
          properties: {
            foo: { type: "string", default: "default" },
            bar: { type: "number", default: 2 },
          },
        },
        default_config: { foo: "default", bar: 2 },
      }),
    ];
    const created = makeCollection();
    api.createCollection.mockResolvedValueOnce(created);

    // Open the wizard and expand Advanced BEFORE the pipelines/specs have loaded.
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

    fireEvent.change(screen.getByPlaceholderText(namePlaceholder), {
      target: { value: "Collection" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Defaults/ }));
    fireEvent.click(screen.getByText("Show"));
    // No pipelines yet, so the defaults aren't selected and nothing can be seeded here.
    expect(screen.getByText(advancedUnavailableMessage)).toBeInTheDocument();

    // Pipelines and specs resolve while the panel is already expanded.
    rerender(
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

    // The overrides state (not just the editor's display fallback) must be seeded.
    await waitFor(() => {
      expect(overridesByTitle[ingestionDefaultsTitle]).toEqual({
        "node-1": { foo: "override", bar: 2 },
      });
    });

    // Simulate a user edit exactly as PipelineOverridesEditor.handleConfigChange does:
    // it builds the next per-node config from `overrides[nodeId] ?? {}`, so if the
    // seed hadn't happened the edit would produce a one-field config.
    act(() => {
      const current = overridesByTitle[ingestionDefaultsTitle];
      const nextConfig = { ...(current["node-1"] ?? {}), foo: "edited" };
      overridesChangeByTitle[ingestionDefaultsTitle]({ ...current, "node-1": nextConfig });
    });

    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: createButtonLabel }));
    });

    await waitFor(() => {
      expect(api.createCollection).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({
          pipeline_overrides: {
            ingestion: [{ node_id: "node-1", config: { foo: "edited", bar: 2 } }],
            retrieval: [{ node_id: "node-2", config: { foo: "override", bar: 2 } }],
          },
        }),
      );
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
    const overridePipeline: Pipeline = {
      ...ingestion,
      definition: {
        nodes: [{ id: "node-override", type: "node.type", name: "Node", config: { foo: "bar" } }],
        edges: [],
      },
    };
    const specsWithDefaults: NodeSpec[] = [
      makeNodeSpec({
        ...nodeSpecs[0],
        config_schema: { properties: { foo: { type: "string" } } },
        default_config: { foo: "default", bar: "from-default" },
      }),
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

    expect(overridesByTitle[ingestionDefaultsTitle]?.["node-override"]).toEqual({
      bar: "from-default",
      foo: "bar",
    });
  });

  it("uses the first pipeline when defaults are missing", () => {
    const firstIngestion: Pipeline = { ...ingestion, id: "ing-2", is_default: false };
    const firstRetrieval: Pipeline = { ...retrieval, id: "ret-2", is_default: false };
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
    api.createCollection.mockRejectedValueOnce(new Error(createFailedMessage));
    const nonDefault: Pipeline = { ...ingestion, id: "ing-2", is_default: false };
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

    fireEvent.change(screen.getByPlaceholderText(namePlaceholder), {
      target: { value: "Collection" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "ing-2" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Show"));
    expect(screen.getByText(advancedUnavailableMessage)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: createButtonLabel }));
    });

    await waitFor(() => {
      expect(screen.getByText(createFailedMessage)).toBeInTheDocument();
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

    fireEvent.change(screen.getByPlaceholderText(namePlaceholder), {
      target: { value: "Collection" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: createButtonLabel }));
    });

    await waitFor(() => {
      expect(screen.getByText(createFailedMessage)).toBeInTheDocument();
    });
  });
});
