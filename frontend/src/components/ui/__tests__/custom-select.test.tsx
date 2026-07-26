import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CustomSelect } from "@/components/ui/custom-select";
import { ModalOverlay } from "@/components/ui/modal-overlay";

const SELECT_LABEL = "Vector index";
const PLACEHOLDER = "Select an index";
const ALPHA_INDEX = "Alpha index";
const BETA_INDEX = "Beta index";
const CHARLIE_INDEX = "Charlie index";
const ADD_INDEX = "Add new index";
const options = [
  { value: "", label: PLACEHOLDER },
  { value: "alpha", label: ALPHA_INDEX },
  { value: "beta", label: BETA_INDEX, disabled: true },
  { value: "charlie", label: CHARLIE_INDEX },
];

function ControlledSelect({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <CustomSelect
      aria-label={SELECT_LABEL}
      value={value}
      options={options}
      placeholder={PLACEHOLDER}
      disabled={disabled}
      onValueChange={setValue}
    />
  );
}

function SelectOpeningDialog() {
  const [managerOpen, setManagerOpen] = useState(false);
  return (
    <>
      <CustomSelect
        aria-label={SELECT_LABEL}
        value=""
        options={[
          { value: "", label: PLACEHOLDER },
          { value: "__create__", label: ADD_INDEX, preventFocusRestore: true },
        ]}
        placeholder={PLACEHOLDER}
        onValueChange={(value) => setManagerOpen(value === "__create__")}
      />
      <ModalOverlay open={managerOpen} onClose={() => setManagerOpen(false)} labelledBy="manager">
        <div>
          <h2 id="manager">Index manager</h2>
          <button type="button">Manager action</button>
        </div>
      </ModalOverlay>
    </>
  );
}

describe("CustomSelect", () => {
  it("exposes combobox/listbox semantics and renders its popup in a portal", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div className="overflow-hidden">
        <ControlledSelect />
      </div>,
    );

    const trigger = screen.getByRole("combobox", { name: SELECT_LABEL });
    expect(trigger).toHaveTextContent(PLACEHOLDER);
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const listbox = screen.getByRole("listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(container).not.toContainElement(listbox);
    expect(screen.getByRole("option", { name: BETA_INDEX })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("supports Arrow Up/Down, Home/End, Enter, Space, and selection announcement", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    await user.tab();
    const trigger = screen.getByRole("combobox", { name: SELECT_LABEL });
    expect(trigger).toHaveFocus();

    await user.keyboard(" ");
    await user.keyboard("{End}{Enter}");
    expect(trigger).toHaveTextContent(CHARLIE_INDEX);

    await user.keyboard("{Enter}{ArrowUp}{Enter}");
    expect(trigger).toHaveTextContent(ALPHA_INDEX);

    await user.keyboard("{Enter}{Home}{ArrowDown}{Enter}");
    expect(trigger).toHaveTextContent(ALPHA_INDEX);

    await user.keyboard("{Enter}");
    expect(screen.getByRole("option", { name: ALPHA_INDEX })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("supports typeahead and returns focus to the trigger on Escape", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    const trigger = screen.getByRole("combobox", { name: SELECT_LABEL });
    trigger.focus();
    await user.keyboard("{Enter}char{Enter}");
    expect(trigger).toHaveTextContent(CHARLIE_INDEX);

    await user.keyboard("{Enter}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps focus in a dialog opened by an action option", async () => {
    const user = userEvent.setup();
    render(<SelectOpeningDialog />);

    const trigger = screen.getByRole("combobox", { name: SELECT_LABEL });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: ADD_INDEX }));

    expect(screen.getByRole("dialog", { name: "Index manager" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manager action" })).toHaveFocus();
  });

  it("closes on outside interaction and prevents disabled selection", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <div>
        <CustomSelect
          aria-label={SELECT_LABEL}
          value=""
          options={options}
          placeholder={PLACEHOLDER}
          onValueChange={onValueChange}
        />
        <button type="button">Outside</button>
      </div>,
    );

    const trigger = screen.getByRole("combobox", { name: SELECT_LABEL });
    await user.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: BETA_INDEX }));
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByText("Outside"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("renders option icons in the popup and on the trigger, without changing accessible names", async () => {
    const user = userEvent.setup();
    function IconSelect() {
      const [value, setValue] = useState("");
      return (
        <CustomSelect
          aria-label={SELECT_LABEL}
          value={value}
          placeholder={PLACEHOLDER}
          options={[
            { value: "", label: PLACEHOLDER },
            { value: "alpha", label: ALPHA_INDEX, icon: <svg data-testid="alpha-icon" /> },
          ]}
          onValueChange={setValue}
        />
      );
    }
    render(<IconSelect />);

    const trigger = screen.getByRole("combobox", { name: SELECT_LABEL });
    await user.click(trigger);
    const option = screen.getByRole("option", { name: ALPHA_INDEX });
    expect(within(option).getByTestId("alpha-icon")).toBeInTheDocument();

    await user.click(option);
    expect(trigger).toHaveTextContent(ALPHA_INDEX);
    expect(within(trigger).getByTestId("alpha-icon")).toBeInTheDocument();
  });

  it("does not dismiss the dialog it sits in when opened with the mouse", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function WizardHarness() {
      const [open, setOpen] = useState(true);
      return (
        <ModalOverlay
          open={open}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          labelledBy="wizard"
        >
          <div>
            <h2 id="wizard">New run</h2>
            <ControlledSelect />
          </div>
        </ModalOverlay>
      );
    }
    render(<WizardHarness />);

    const backdrop = screen.getByRole("presentation");
    const trigger = screen.getByRole("combobox", { name: SELECT_LABEL });
    // Press without releasing: Radix opens the popup on pointerdown and calls
    // preventDefault, so the pointerup never lands on the trigger.
    await user.pointer({ keys: "[MouseLeft>]", target: trigger });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // The popup portals to <body>, so the browser dispatches the click of that
    // same gesture on the backdrop rather than on the trigger.
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    // Radix marks everything outside its popup aria-hidden while open, so query
    // the wizard by text rather than by dialog role.
    expect(screen.getByText("New run")).toBeInTheDocument();
  });

  it("announces and enforces a disabled trigger", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect disabled />);

    const trigger = screen.getByRole("combobox", { name: SELECT_LABEL });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
