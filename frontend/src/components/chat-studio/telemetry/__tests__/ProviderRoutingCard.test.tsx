import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProviderRoutingCard } from "@/components/chat-studio/telemetry/ProviderRoutingCard";

import type { ProviderFormState } from "@/components/chat-studio/types";
import type { ModelEndpointDirectory, ProviderEndpoint } from "@/lib/types";

const endpoints: ProviderEndpoint[] = [
  {
    name: "openai/gpt-4",
    provider_name: "OpenAI",
    status: 0,
    uptime_last_30m: 0.99,
    pricing: { prompt: 0.0002, completion: 0.00002 },
    context_length: 4096,
    supported_parameters: ["temperature"],
    tag: "beta",
    supports_implicit_caching: true,
    quantization: "fp16",
  },
  {
    name: "openai/fast",
    provider_name: "OpenAI",
    status: "0",
    uptime_last_30m: 0.5,
    pricing: { prompt: 0.00005, completion: 0.0000005 },
    context_length: 2048,
    supported_parameters: ["temperature"],
  },
  {
    name: "mistral/mixtral",
    provider_name: "Mistral",
    status: -1,
    uptime_last_30m: 50,
    pricing: { prompt: 0.0000015, completion: 0.00000015 },
    max_completion_tokens: 2048,
    supported_parameters: [],
    quantization: { precision: "int8" },
  },
  {
    name: "custom/mini",
    provider_name: "Custom",
    status: 999,
    uptime_last_30m: null,
    pricing: { prompt: 0.000000015, completion: 0.000000001 },
    max_prompt_tokens: 1024,
  },
  {
    name: "tiny/model",
    provider_name: null,
    status: null,
    uptime_last_30m: null,
    pricing: { prompt: 0.0000000005, completion: 0.0000000005 },
    tag: null,
  },
  {
    name: "free/model",
    provider_name: "Free",
    status: null,
    uptime_last_30m: null,
    pricing: { prompt: "free", completion: null },
  },
  {
    name: "edge/trim",
    provider_name: "Edge",
    status: null,
    uptime_last_30m: null,
    pricing: { prompt: "   ", completion: "free" },
  },
  {
    name: "edge/mid",
    provider_name: "Edge",
    status: null,
    uptime_last_30m: 0.2,
    pricing: { prompt: 0.0000002, completion: 0.0000002 },
  },
  {
    name: "edge/na",
    provider_name: "Edge",
    status: null,
    uptime_last_30m: null,
    pricing: { prompt: "n/a", completion: "n/a" },
  },
  {
    name: "edge/parsed",
    provider_name: "Edge",
    status: null,
    uptime_last_30m: 0.9,
    pricing: { prompt: "0.00005", completion: null },
  },
];

const directory: ModelEndpointDirectory = {
  id: "dir-1",
  name: "Dir",
  endpoints,
};

const baseForm: ProviderFormState = {
  sort: "",
  order: [],
  only: [],
  ignore: [],
  quantizations: [],
  allowFallbacks: true,
  requireParameters: false,
  dataCollection: "allow",
  zdr: false,
  enforceDistillableText: false,
  maxPrompt: "",
  maxCompletion: "",
  maxRequest: "",
  maxImage: "",
};

const Harness = (props: {
  providerDirectory: ModelEndpointDirectory | null;
  providerDirectoryLoading: boolean;
  providerDirectoryError: string | null;
  providerModelSlug: string | null;
  providerRuleCount: number;
}) => {
  const [providerForm, setProviderForm] = useState(baseForm);
  const [providerSearchTerm, setProviderSearchTerm] = useState("");
  return (
    <ProviderRoutingCard
      providerForm={providerForm}
      setProviderForm={setProviderForm}
      providerDirectory={props.providerDirectory}
      providerDirectoryLoading={props.providerDirectoryLoading}
      providerDirectoryError={props.providerDirectoryError}
      providerModelSlug={props.providerModelSlug}
      providerSearchTerm={providerSearchTerm}
      setProviderSearchTerm={setProviderSearchTerm}
      providerRuleCount={props.providerRuleCount}
      resetProviderPreferences={() => undefined}
    />
  );
};

describe("ProviderRoutingCard", () => {
  it("renders provider catalog states", () => {
    const { rerender } = render(
      <ProviderRoutingCard
        providerForm={baseForm}
        setProviderForm={() => undefined}
        providerDirectory={directory}
        providerDirectoryLoading
        providerDirectoryError={null}
        providerModelSlug="openai/gpt-4"
        providerSearchTerm=""
        setProviderSearchTerm={() => undefined}
        providerRuleCount={0}
        resetProviderPreferences={() => undefined}
      />,
    );

    expect(screen.getByText(/Loading endpoints/)).toBeInTheDocument();

    rerender(
      <ProviderRoutingCard
        providerForm={baseForm}
        setProviderForm={() => undefined}
        providerDirectory={directory}
        providerDirectoryLoading={false}
        providerDirectoryError="Error"
        providerModelSlug="openai/gpt-4"
        providerSearchTerm=""
        setProviderSearchTerm={() => undefined}
        providerRuleCount={0}
        resetProviderPreferences={() => undefined}
      />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();

    rerender(
      <ProviderRoutingCard
        providerForm={baseForm}
        setProviderForm={() => undefined}
        providerDirectory={null}
        providerDirectoryLoading={false}
        providerDirectoryError={null}
        providerModelSlug={null}
        providerSearchTerm=""
        setProviderSearchTerm={() => undefined}
        providerRuleCount={0}
        resetProviderPreferences={() => undefined}
      />,
    );
    expect(screen.getByText(/Pick a model/)).toBeInTheDocument();

    rerender(
      <ProviderRoutingCard
        providerForm={baseForm}
        setProviderForm={() => undefined}
        providerDirectory={directory}
        providerDirectoryLoading={false}
        providerDirectoryError={null}
        providerModelSlug="openai/gpt-4"
        providerSearchTerm="missing"
        setProviderSearchTerm={() => undefined}
        providerRuleCount={0}
        resetProviderPreferences={() => undefined}
      />,
    );
    expect(screen.getByText(/No providers match/)).toBeInTheDocument();

    rerender(
      <ProviderRoutingCard
        providerForm={baseForm}
        setProviderForm={() => undefined}
        providerDirectory={{ id: "dir-2", name: "Empty", endpoints: [] }}
        providerDirectoryLoading={false}
        providerDirectoryError={null}
        providerModelSlug="openai/gpt-4"
        providerSearchTerm=""
        setProviderSearchTerm={() => undefined}
        providerRuleCount={0}
        resetProviderPreferences={() => undefined}
      />,
    );
    expect(screen.getByText(/No endpoints published/)).toBeInTheDocument();
  });

  it("updates form controls and selections", () => {
    const resetProviderPreferences = vi.fn();

    render(
      <ProviderRoutingCard
        providerForm={{ ...baseForm, order: ["openai/gpt-4", "mistral/mixtral"] }}
        setProviderForm={(updater) => updater(baseForm)}
        providerDirectory={directory}
        providerDirectoryLoading={false}
        providerDirectoryError={null}
        providerModelSlug="openai/gpt-4"
        providerSearchTerm=""
        setProviderSearchTerm={() => undefined}
        providerRuleCount={1}
        resetProviderPreferences={resetProviderPreferences}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset rules" }));
    expect(resetProviderPreferences).toHaveBeenCalled();
  });

  it("guards provider reordering when state changes", () => {
    const { unmount } = render(
      <ProviderRoutingCard
        providerForm={{ ...baseForm, order: ["openai/gpt-4", "mistral/mixtral"] }}
        setProviderForm={(updater) => updater(baseForm)}
        providerDirectory={directory}
        providerDirectoryLoading={false}
        providerDirectoryError={null}
        providerModelSlug="openai/gpt-4"
        providerSearchTerm=""
        setProviderSearchTerm={() => undefined}
        providerRuleCount={1}
        resetProviderPreferences={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Move openai\/gpt-4 later/ }));
    unmount();

    render(
      <ProviderRoutingCard
        providerForm={{ ...baseForm, order: ["openai/gpt-4", "mistral/mixtral"] }}
        setProviderForm={(updater) => updater({ ...baseForm, order: ["openai/gpt-4"] })}
        providerDirectory={directory}
        providerDirectoryLoading={false}
        providerDirectoryError={null}
        providerModelSlug="openai/gpt-4"
        providerSearchTerm=""
        setProviderSearchTerm={() => undefined}
        providerRuleCount={1}
        resetProviderPreferences={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Move openai\/gpt-4 later/ }));
  });

  it("wires provider interactions", () => {
    render(
      <Harness
        providerDirectory={directory}
        providerDirectoryLoading={false}
        providerDirectoryError={null}
        providerModelSlug="openai/gpt-4"
        providerRuleCount={1}
      />,
    );

    expect(screen.getAllByText("Unknown provider").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("combobox", { name: /Sort providers/ }), {
      target: { value: "price" },
    });

    fireEvent.click(screen.getByLabelText("Allow fallbacks"));

    const orderButtons = screen.getAllByRole("button", { name: /Add to order/ });
    fireEvent.click(orderButtons[0]);
    fireEvent.click(orderButtons[1]);
    const allowButtons = screen.getAllByRole("button", { name: /Allow only/ });
    fireEvent.click(allowButtons[0]);
    const ignoreButtons = screen.getAllByRole("button", { name: /Ignore/ });
    fireEvent.click(ignoreButtons[0]);

    const moveEarlierButtons = screen.getAllByRole("button", { name: /Move .* earlier/ });
    const moveLaterButtons = screen.getAllByRole("button", { name: /Move .* later/ });
    const enabledEarlier = moveEarlierButtons.find((button) => !button.hasAttribute("disabled"));
    const enabledLater = moveLaterButtons.find((button) => !button.hasAttribute("disabled"));
    if (!enabledEarlier || !enabledLater) {
      throw new Error("Expected enabled move buttons for provider order");
    }
    fireEvent.click(enabledEarlier);
    fireEvent.click(enabledLater);

    const removeButtons = screen.getAllByRole("button", { name: /Remove / });
    fireEvent.click(removeButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: "INT4" }));
    expect(screen.getByText(/selected/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "INT4" }));

    fireEvent.click(screen.getByLabelText("Require parameters"));
    fireEvent.change(screen.getByRole("combobox", { name: /Data collection/ }), {
      target: { value: "deny" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /Data collection/ }), {
      target: { value: "allow" },
    });
    fireEvent.click(screen.getByLabelText("Zero data retention"));
    fireEvent.click(screen.getByLabelText("Distillable text only"));

    fireEvent.change(screen.getByPlaceholderText(/Search provider/), {
      target: { value: "openai" },
    });

    fireEvent.change(screen.getByPlaceholderText("1.00"), { target: { value: "2" } });
    fireEvent.change(screen.getByPlaceholderText("2.00"), { target: { value: "3" } });
    fireEvent.change(screen.getByPlaceholderText("0.25"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByPlaceholderText("0.02"), { target: { value: "0.1" } });

    expect(screen.getByText(/provider routing guide/)).toBeInTheDocument();
  }, 10000);

  it("renders provider pricing fallbacks", () => {
    render(
      <ProviderRoutingCard
        providerForm={baseForm}
        setProviderForm={() => undefined}
        providerDirectory={directory}
        providerDirectoryLoading={false}
        providerDirectoryError={null}
        providerModelSlug="openai/gpt-4"
        providerSearchTerm=""
        setProviderSearchTerm={() => undefined}
        providerRuleCount={0}
        resetProviderPreferences={() => undefined}
      />,
    );

    expect(screen.getAllByText("free").length).toBeGreaterThan(0);
    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$50.0/M").length).toBeGreaterThan(0);
  });
});
