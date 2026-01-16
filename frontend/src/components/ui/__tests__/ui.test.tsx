import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";
import { CollapsibleReasoning } from "@/components/ui/collapsible-reasoning";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader } from "@/components/ui/loader";
import { Notification } from "@/components/ui/notification";
import { GlassCard } from "@/components/ui/panel";
import { ParameterFieldCard, ParameterInput } from "@/components/ui/parameter-controls";
import { Tooltip } from "@/components/ui/tooltip";
import { TypingAnimation } from "@/components/ui/typing-animation";
import { WizardShell } from "@/components/ui/wizard-shell";

import type { ReasoningTraceSegment } from "@/lib/types";

describe("ui components", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("renders button variants, sizes, and loading state", () => {
    const { rerender } = render(
      <Button variant="primary" size="sm">
        Primary
      </Button>,
    );
    expect(screen.getByText("Primary")).toBeInTheDocument();

    rerender(
      <Button variant="secondary" size="md">
        Secondary
      </Button>,
    );
    expect(screen.getByText("Secondary")).toBeInTheDocument();

    rerender(
      <Button variant="ghost" size="lg" loading>
        Ghost
      </Button>,
    );
    expect(screen.getByText(/Working/i)).toBeInTheDocument();
  });

  it("renders and toggles collapsible reasoning", () => {
    const segments: ReasoningTraceSegment[] = [
      { type: "analysis", text: "first" },
      { content: "second" },
      { value: 3 },
    ];
    const onManualToggle = vi.fn();
    const { rerender } = render(
      <CollapsibleReasoning
        segments={segments}
        messageId="msg-1"
        subtitle="details"
        onManualToggle={onManualToggle}
        isAutoOpen={false}
      />,
    );

    const button = screen.getByRole("button", { name: /reasoning/i });
    fireEvent.click(button);
    expect(onManualToggle).toHaveBeenCalledWith("msg-1", true);

    rerender(<CollapsibleReasoning segments={[{ text: "only" }]} messageId="msg-1" />);
    expect(screen.getByText(/1 step/i)).toBeInTheDocument();

    rerender(<CollapsibleReasoning segments={[]} messageId="msg-1" />);
    expect(screen.queryByRole("button", { name: /reasoning/i })).not.toBeInTheDocument();
  });

  it("shows confirm dialog and handles actions", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open={false} title="Confirm" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <ConfirmDialog
        open
        title="Confirm"
        description="Are you sure?"
        confirmVariant="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));
    expect(onCancel).toHaveBeenCalled();

    rerender(
      <ConfirmDialog open title="No description" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.queryByText("Are you sure?")).not.toBeInTheDocument();
  });

  it("renders loader and panel", () => {
    const { container } = render(
      <GlassCard>
        <Loader />
      </GlassCard>,
    );
    expect(container.querySelector("span")).toBeInTheDocument();
  });

  it("handles notifications with dismiss and auto-dismiss", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Notification message="Hello" title="Notice" onDismiss={onDismiss} autoDismissMs={10} />,
    );
    const dismissButton = screen.getByLabelText("Dismiss notification");
    fireEvent.click(dismissButton);
    fireEvent.click(dismissButton);
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(onDismiss).toHaveBeenCalled();

    rerender(<Notification message="Paused dismiss" onDismiss={onDismiss} autoDismissMs={0} />);
    rerender(<Notification message="No dismiss" />);
    expect(screen.queryByLabelText("Dismiss notification")).not.toBeInTheDocument();
  });

  it("renders parameter controls for each input type", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ParameterFieldCard
        label="Field"
        description="Desc"
        helper="Help"
        overrideActive
        actionLabel="Reset"
        onAction={() => onChange("reset")}
      >
        <ParameterInput input="number" value={1} onChange={onChange} />
      </ParameterFieldCard>,
    );

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith("2");

    rerender(<ParameterInput input="boolean" value onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));

    rerender(
      <ParameterInput
        input="select"
        value="a"
        options={[{ label: "A", value: "a" }]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });

    rerender(<ParameterInput input="list" value="x" onChange={onChange} rows={2} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "y" } });

    rerender(<ParameterInput input="json" value="{}" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "{}" } });

    rerender(<ParameterInput input="text" value="z" onChange={onChange} rows={3} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "w" } });

    rerender(<ParameterInput input="number" value="nope" onChange={onChange} />);
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("");

    rerender(<ParameterInput input="select" value={5} onChange={onChange} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");

    rerender(<ParameterInput input="list" value={5} onChange={onChange} rows={2} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");

    rerender(<ParameterInput input="text" value={5} onChange={onChange} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("renders tooltips and typing animation", () => {
    render(
      <div>
        <Tooltip content="" side="left">
          <span>Label</span>
        </Tooltip>
        <Tooltip content="Info" side="right">
          <span>Label</span>
        </Tooltip>
        <TypingAnimation />
      </div>,
    );
    expect(screen.getAllByText("Label")).toHaveLength(2);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Info");
  });

  it("renders wizard shell and supports steps", () => {
    const onStepChange = vi.fn();
    const onClose = vi.fn();
    const steps = [
      { id: "one", label: "One", description: "First" },
      { id: "two", label: "Two", description: "Second" },
    ];
    const { rerender } = render(
      <WizardShell
        open={false}
        title="Wizard"
        subtitle="Sub"
        steps={steps}
        activeStepIndex={0}
        onStepChange={onStepChange}
        onClose={onClose}
        footer={<div>Footer</div>}
      >
        <div>Body</div>
      </WizardShell>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <WizardShell
        open
        title="Wizard"
        subtitle="Sub"
        steps={steps}
        activeStepIndex={1}
        message="Warning"
        onStepChange={onStepChange}
        onClose={onClose}
        footer={<div>Footer</div>}
      >
        <div>Body</div>
      </WizardShell>,
    );

    fireEvent.click(screen.getByLabelText("Close wizard"));
    fireEvent.click(screen.getByText("One"));
    expect(onStepChange).toHaveBeenCalledWith(0);
  });
});
