import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { useNodeEditing } from "@/components/pipelines/hooks/use-node-editing";
import { BranchesEditor } from "@/components/pipelines/IoDeclarationEditors";
import { specToNodeData } from "@/components/pipelines/lib/pipeline-utils";
import { buildStaticEnvironment } from "@/components/pipelines/lib/variable-env";
import { NodeEditorDrawer } from "@/components/pipelines/NodeEditorDrawer";
import { PipelineNode } from "@/components/pipelines/PipelineNode";
import { makeNodeSpec } from "@/test/fixtures";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodePort, NodeSpec, PipelineRouterBranch } from "@/lib/types";
import type { Node, NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";

const ROUTER_TYPE = "route.branch";
const ADD_BRANCH = "Add branch";
const SAVE_NODE = "Save node";
const BRANCH_NAME = "Name";

vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id: string; type: string }) => (
    <div data-testid={`${type}-${id}`} />
  ),
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  NodeToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));

const port = (overrides: Partial<NodePort> & Pick<NodePort, "key" | "label">): NodePort => ({
  data_type: "items",
  required: false,
  accepts_many: false,
  requires: [],
  adds: [],
  accepts: [],
  unaccepted: "passthrough" as const,
  preserves: true,
  removes: [],
  ...overrides,
});

const routerSpec = (): NodeSpec =>
  makeNodeSpec({
    type: ROUTER_TYPE,
    label: "Router",
    category: "utility",
    input_ports: [port({ key: "items", label: "Items" })],
    output_ports: [port({ key: "unmatched", label: "Unmatched" })],
    dynamic_output_ports: {
      config_field: "branches",
      id_field: "id",
      label_field: "name",
      key_prefix: "branch",
      template: port({ key: "", label: "" }),
    },
    default_config: { branches: [] },
  });

const nodeProps = (data: PipelineNodeData): NodeProps<Node<PipelineNodeData>> => ({
  id: "node-1",
  type: "pipelineNode",
  data,
  selected: false,
  selectable: true,
  deletable: true,
  draggable: true,
  dragging: false,
  zIndex: 0,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
});

/**
 * The canvas node and the drawer editing it, joined by the same
 * `useNodeEditing` state the builder uses — so a branch saved in the drawer
 * reaches the card exactly as it does in the editor.
 */
function RouterEditor() {
  const [nodes, setNodes] = React.useState<Node<PipelineNodeData>[]>(() => [
    {
      id: "node-1",
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: specToNodeData(routerSpec()),
    },
  ]);
  const editing = useNodeEditing({ nodes, setNodes, setEdges: () => undefined });
  return (
    <>
      <PipelineNode {...nodeProps(nodes[0].data)} />
      <NodeEditorDrawer
        node={nodes[0]}
        onClose={() => undefined}
        onApply={editing.applyNodeEdits}
        isPreview={false}
        validationErrors={[]}
        validationIssues={[]}
        vectorIndexes={[]}
        variables={[]}
        embeddingModels={[]}
        embeddingCatalog={null}
        embeddingModelsLoading={false}
        embeddingModelsError={null}
        rerankingModels={[]}
        rerankingCatalog={null}
        rerankingModelsLoading={false}
        rerankingModelsError={null}
        onRetryRerankingModels={() => undefined}
        llmModels={[]}
        llmCatalog={null}
        llmModelsLoading={false}
        llmModelsError={null}
        onRetryLlmModels={() => undefined}
        hasRerankingProvider
      />
    </>
  );
}

const branchHandles = () =>
  screen.queryAllByTestId(/^source-branch:/).map((element) => element.dataset.testid);

describe("router branches", () => {
  it("gives a branch saved in the drawer a connectable handle on the canvas", async () => {
    const user = userEvent.setup();
    render(<RouterEditor />);

    expect(branchHandles()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: ADD_BRANCH }));
    const name = screen.getByLabelText(BRANCH_NAME);
    await user.clear(name);
    await user.type(name, "Images");
    await user.type(screen.getByLabelText("Expression for Images"), "item.has_image");
    await user.click(screen.getByRole("button", { name: SAVE_NODE }));

    // The handle the user must be able to wire from, labelled by the branch.
    expect(branchHandles()).toHaveLength(1);
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.getByTestId("source-unmatched")).toBeInTheDocument();
  });
});

/** The editor driven as the drawer drives it: config in, config out. */
function ControlledBranches({ initial }: { initial: PipelineRouterBranch[] }) {
  const [branches, setBranches] = React.useState(initial);
  return (
    <>
      <BranchesEditor
        branches={branches}
        onChange={setBranches}
        env={buildStaticEnvironment([])}
        disabled={false}
      />
      <pre data-testid="branches">{JSON.stringify(branches)}</pre>
    </>
  );
}

const readBranches = (): PipelineRouterBranch[] =>
  JSON.parse(screen.getByTestId("branches").textContent ?? "[]") as PipelineRouterBranch[];

const branch = (id: string, name: string, expression = "item.has_text"): PipelineRouterBranch => ({
  id,
  name,
  expression,
});

describe("BranchesEditor", () => {
  it("mints a new id for an added branch and leaves the existing ids alone", async () => {
    const user = userEvent.setup();
    render(<ControlledBranches initial={[branch("keep-1", "Images")]} />);

    await user.click(screen.getByRole("button", { name: ADD_BRANCH }));

    const [first, second] = readBranches();
    expect(first.id).toBe("keep-1");
    expect(second.id).not.toBe("keep-1");
    expect(second.id).toBeTruthy();
  });

  it("keeps a branch's id when it is renamed, so wired edges survive", async () => {
    const user = userEvent.setup();
    render(<ControlledBranches initial={[branch("keep-1", "Images")]} />);

    await user.type(screen.getByLabelText(BRANCH_NAME), " and figures");

    expect(readBranches()).toEqual([branch("keep-1", "Images and figures")]);
  });

  it("reorders branches, since the first matching branch takes the item", async () => {
    const user = userEvent.setup();
    render(
      <ControlledBranches initial={[branch("a", "Images"), branch("b", "Long text")]} />,
    );

    await user.click(screen.getByRole("button", { name: "Move Long text up" }));

    expect(readBranches().map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("deletes only the branch whose control was used", async () => {
    const user = userEvent.setup();
    render(
      <ControlledBranches
        initial={[branch("a", "Images"), branch("b", "Long text"), branch("c", "Scored")]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete Long text" }));

    expect(readBranches().map((entry) => entry.id)).toEqual(["a", "c"]);
  });
});
