import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelParametersCard } from "@/components/chat-studio/telemetry/ModelParametersCard";

import type { ParameterDefinition } from "@/lib/chat-parameters";
import type { ModelInfo } from "@/lib/types";

vi.mock("@/components/ui/parameter-controls", () => ({
  ParameterFieldCard: ({
    label,
    helper,
    actionLabel,
    actionDisabled,
    onAction,
    children,
  }: {
    label: string;
    helper?: string | null;
    actionLabel?: string;
    actionDisabled?: boolean;
    onAction?: () => void;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{label}</span>
      {helper && <span>{helper}</span>}
      {actionLabel && (
        <button type="button" disabled={actionDisabled} onClick={onAction}>
          {actionLabel}
        </button>
      )}
      {children}
    </div>
  ),
  ParameterInput: ({
    input,
    onChange,
  }: {
    input: string;
    onChange: (value: string | boolean) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        if (input === "number") onChange("1.5");
        else if (input === "integer") onChange("2");
        else if (input === "boolean") onChange(true);
        else if (input === "select") onChange("opt");
        else onChange("text");
      }}
    >
      trigger-{input}
    </button>
  ),
}));

describe("ModelParametersCard", () => {
  const model: ModelInfo = {
    id: "model-1",
    name: "Model",
    supported_parameters: [],
  };

  it("renders error and loading states", () => {
    const { rerender } = render(
      <ModelParametersCard
        currentModelInfo={null}
        visibleParameterDefinitions={[]}
        parameterOverrides={{}}
        activeParameterCount={0}
        resetAllParameters={() => undefined}
        handleNumberParameterChange={() => undefined}
        handleBooleanParameterChange={() => undefined}
        handleTextParameterChange={() => undefined}
        handleSelectParameterChange={() => undefined}
        handleClearParameter={() => undefined}
        formatDefaultParameter={() => null}
        modelsError="Error"
        modelsLoading={false}
      />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();

    rerender(
      <ModelParametersCard
        currentModelInfo={null}
        visibleParameterDefinitions={[]}
        parameterOverrides={{}}
        activeParameterCount={0}
        resetAllParameters={() => undefined}
        handleNumberParameterChange={() => undefined}
        handleBooleanParameterChange={() => undefined}
        handleTextParameterChange={() => undefined}
        handleSelectParameterChange={() => undefined}
        handleClearParameter={() => undefined}
        formatDefaultParameter={() => null}
        modelsError={null}
        modelsLoading
      />,
    );
    expect(screen.getByText(/Loading model catalog/)).toBeInTheDocument();
  });

  it("renders empty definitions and controls", () => {
    const { rerender } = render(
      <ModelParametersCard
        currentModelInfo={null}
        visibleParameterDefinitions={[]}
        parameterOverrides={{}}
        activeParameterCount={0}
        resetAllParameters={() => undefined}
        handleNumberParameterChange={() => undefined}
        handleBooleanParameterChange={() => undefined}
        handleTextParameterChange={() => undefined}
        handleSelectParameterChange={() => undefined}
        handleClearParameter={() => undefined}
        formatDefaultParameter={() => null}
        modelsError={null}
        modelsLoading={false}
      />,
    );
    expect(screen.getByText(/Unable to find provider metadata/)).toBeInTheDocument();

    rerender(
      <ModelParametersCard
        currentModelInfo={model}
        visibleParameterDefinitions={[]}
        parameterOverrides={{}}
        activeParameterCount={0}
        resetAllParameters={() => undefined}
        handleNumberParameterChange={() => undefined}
        handleBooleanParameterChange={() => undefined}
        handleTextParameterChange={() => undefined}
        handleSelectParameterChange={() => undefined}
        handleClearParameter={() => undefined}
        formatDefaultParameter={() => null}
        modelsError={null}
        modelsLoading={false}
      />,
    );
    expect(screen.getByText(/does not expose/)).toBeInTheDocument();
  });

  it("wires parameter handlers and reset", () => {
    const handleNumberParameterChange = vi.fn();
    const handleBooleanParameterChange = vi.fn();
    const handleTextParameterChange = vi.fn();
    const handleSelectParameterChange = vi.fn();
    const handleClearParameter = vi.fn();
    const resetAllParameters = vi.fn();

    // These fixtures use arbitrary keys/inputs to exercise ModelParametersCard's generic
    // control-rendering logic; they don't correspond to the app's real, narrowly-typed
    // PARAMETER_DEFINITIONS union, so the cast is required here.
    const definitions = [
      { key: "temperature", label: "Temperature", input: "number", required: false },
      { key: "top_k", label: "Top K", input: "integer", required: false },
      { key: "use_tools", label: "Use Tools", input: "boolean", required: false },
      {
        key: "mode",
        label: "Mode",
        input: "select",
        options: [{ label: "Opt", value: "opt" }],
        required: false,
      },
      { key: "prompt", label: "Prompt", input: "text", required: false },
    ] as unknown as ParameterDefinition[];

    render(
      <ModelParametersCard
        currentModelInfo={model}
        visibleParameterDefinitions={definitions}
        parameterOverrides={{ temperature: 0.5 }}
        activeParameterCount={1}
        resetAllParameters={resetAllParameters}
        handleNumberParameterChange={handleNumberParameterChange}
        handleBooleanParameterChange={handleBooleanParameterChange}
        handleTextParameterChange={handleTextParameterChange}
        handleSelectParameterChange={handleSelectParameterChange}
        handleClearParameter={handleClearParameter}
        formatDefaultParameter={(key) => (key === "temperature" ? "0.7" : null)}
        modelsError={null}
        modelsLoading={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset overrides" }));
    expect(resetAllParameters).toHaveBeenCalled();

    fireEvent.click(screen.getByText("trigger-number"));
    expect(handleNumberParameterChange).toHaveBeenCalledWith("temperature", "1.5", false);

    fireEvent.click(screen.getByText("trigger-integer"));
    expect(handleNumberParameterChange).toHaveBeenCalledWith("top_k", "2", true);

    fireEvent.click(screen.getByText("trigger-boolean"));
    expect(handleBooleanParameterChange).toHaveBeenCalledWith("use_tools", true);

    fireEvent.click(screen.getByText("trigger-select"));
    expect(handleSelectParameterChange).toHaveBeenCalledWith("mode", "opt");

    fireEvent.click(screen.getByText("trigger-text"));
    expect(handleTextParameterChange).toHaveBeenCalledWith("prompt", "text");

    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    const clearButton = clearButtons.find((button) => !button.hasAttribute("disabled"));
    if (!clearButton) {
      throw new Error("Enabled clear button not found");
    }
    fireEvent.click(clearButton);
    expect(handleClearParameter).toHaveBeenCalledWith("temperature");

    expect(screen.getByText("Default: 0.7")).toBeInTheDocument();
  });
});
