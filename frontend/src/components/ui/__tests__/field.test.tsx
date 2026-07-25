import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Field, Select, TextArea, TextInput, inputClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

describe("Field", () => {
  it("associates the label with the control via htmlFor/id", () => {
    render(
      <Field label="Email">
        <TextInput type="email" />
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input.id).toBeTruthy();
  });

  it("wires hint text through aria-describedby", () => {
    render(
      <Field label="Name" hint="Shown on your profile.">
        <TextInput />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const hint = document.getElementById(describedBy as string);
    expect(hint).toHaveTextContent("Shown on your profile.");
  });

  it("wires error text through aria-describedby and marks the control invalid", () => {
    render(
      <Field label="Password" error="Too short.">
        <TextInput type="password" />
      </Field>,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent("Too short.");
  });

  it("works with Select and TextArea controls", () => {
    render(
      <div>
        <Field label="Pipeline">
          <Select>
            <option value="a">A</option>
          </Select>
        </Field>
        <Field label="Description">
          <TextArea />
        </Field>
      </div>,
    );
    expect(screen.getByLabelText("Pipeline")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText("Description")).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("controls share the exported inputClass and forward refs", () => {
    const inputRef = createRef<HTMLInputElement>();
    const selectRef = createRef<HTMLSelectElement>();
    const textAreaRef = createRef<HTMLTextAreaElement>();
    render(
      <div>
        <TextInput ref={inputRef} aria-label="input" />
        <Select ref={selectRef} aria-label="select" />
        <TextArea ref={textAreaRef} aria-label="textarea" />
      </div>,
    );
    expect(inputRef.current).toBeInstanceOf(HTMLInputElement);
    expect(selectRef.current).toBeInstanceOf(HTMLSelectElement);
    expect(textAreaRef.current).toBeInstanceOf(HTMLTextAreaElement);
    // Assert the controls share the exported constant, not one of its literal
    // classes — pinning a class name here makes a token change look like a
    // behaviour regression, which is what happened when the radius scale landed.
    for (const el of [inputRef.current, selectRef.current, textAreaRef.current]) {
      expect(el?.className).toBe(cn(inputClass));
    }
  });

  it("renders labelEnd content outside the label element", () => {
    render(
      <Field label="API key" labelEnd={<button type="button">Remove</button>}>
        <TextInput />
      </Field>,
    );
    const input = screen.getByLabelText("API key");
    expect(input).toBeInstanceOf(HTMLInputElement);
    const removeButton = screen.getByRole("button", { name: "Remove" });
    expect(removeButton.closest("label")).toBeNull();
  });

  it("respects an explicit id on the control", () => {
    render(
      <Field label="Custom">
        <TextInput id="custom-id" />
      </Field>,
    );
    expect(screen.getByLabelText("Custom").id).toBe("custom-id");
  });
});
