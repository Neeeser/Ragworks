import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfigFieldControl } from "@/components/admin/settings/ConfigFieldControl";
import { makeConfigField } from "@/test/fixtures";

import type { ConfigFieldRead } from "@/lib/types";

const MAX_UPLOAD_KEY = "uploads.max_upload_size_mb";
const MAX_UPLOAD_LABEL = "Max upload size (MB)";
const ALLOW_REGISTRATION_LABEL = "Allow sign-ups";
const ALLOW_REGISTRATION_DESCRIPTION = "When off, new account registration is disabled.";
const TEXT_PLAIN = "text/plain";
const PLAIN_TEXT_LABEL = "Plain text";
const APPLICATION_PDF = "application/pdf";
const PDF_LABEL = "PDF";

function makeIntField(overrides: Parameters<typeof makeConfigField>[0] = {}) {
  return makeConfigField({
    key: MAX_UPLOAD_KEY,
    label: MAX_UPLOAD_LABEL,
    kind: "int",
    value: 50,
    default: 50,
    ...overrides,
  });
}

/** Wraps ConfigFieldControl with real controlled state so typed digits accumulate. */
function ControlledIntField({
  field,
  initialValue,
  onChange,
}: {
  field: ConfigFieldRead;
  initialValue: number;
  onChange: (value: unknown) => void;
}) {
  const [value, setValue] = useState<unknown>(initialValue);
  return (
    <ConfigFieldControl
      field={field}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      onReset={vi.fn()}
      resetting={false}
    />
  );
}

describe("ConfigFieldControl", () => {
  describe("int field", () => {
    it("does not call onChange when the input is cleared", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <ConfigFieldControl
          field={makeIntField()}
          value={50}
          onChange={onChange}
          onReset={vi.fn()}
          resetting={false}
        />,
      );

      const input = screen.getByLabelText(MAX_UPLOAD_LABEL);
      await user.clear(input);

      expect(onChange).not.toHaveBeenCalled();
    });

    it("does not call onChange for partial/invalid numeric text like '-' or '1e'", () => {
      const onChange = vi.fn();

      render(
        <ConfigFieldControl
          field={makeIntField()}
          value={50}
          onChange={onChange}
          onReset={vi.fn()}
          resetting={false}
        />,
      );

      const input = screen.getByLabelText(MAX_UPLOAD_LABEL) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "-" } });
      fireEvent.change(input, { target: { value: "1e" } });

      expect(onChange).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalledWith(null);
    });

    it("calls onChange with a valid parsed number", () => {
      const onChange = vi.fn();

      render(<ControlledIntField field={makeIntField()} initialValue={50} onChange={onChange} />);

      const input = screen.getByLabelText(MAX_UPLOAD_LABEL) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "75" } });

      expect(onChange).toHaveBeenLastCalledWith(75);
      expect(onChange).not.toHaveBeenCalledWith(0);
      expect(onChange).not.toHaveBeenCalledWith(Number.NaN);
    });
  });

  describe("bool field", () => {
    it("associates the description with the checkbox via aria-describedby", () => {
      const field = makeConfigField({
        key: "auth.allow_registration",
        label: ALLOW_REGISTRATION_LABEL,
        description: ALLOW_REGISTRATION_DESCRIPTION,
        kind: "bool",
        value: true,
        default: true,
      });

      render(
        <ConfigFieldControl
          field={field}
          value={true}
          onChange={vi.fn()}
          onReset={vi.fn()}
          resetting={false}
        />,
      );

      const checkbox = screen.getByLabelText(ALLOW_REGISTRATION_LABEL);
      expect(checkbox).toBeInstanceOf(HTMLInputElement);

      const describedBy = checkbox.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const descriptionEl = document.getElementById(describedBy ?? "");
      expect(descriptionEl).toHaveTextContent(ALLOW_REGISTRATION_DESCRIPTION);
    });
  });

  describe("select field", () => {
    const BACKEND_LABEL = "Default index backend";

    function makeBackendField(overrides: Parameters<typeof makeConfigField>[0] = {}) {
      return makeConfigField({
        key: "indexing.default_backend",
        label: BACKEND_LABEL,
        kind: "select",
        options: [
          { value: "pgvector", label: "pgvector" },
          { value: "pinecone", label: "Pinecone" },
        ],
        value: "pgvector",
        default: "pgvector",
        ...overrides,
      });
    }

    it("renders the current value and calls onChange when another option is picked", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <ConfigFieldControl
          field={makeBackendField()}
          value="pgvector"
          onChange={onChange}
          onReset={vi.fn()}
          resetting={false}
        />,
      );

      const trigger = screen.getByRole("combobox", { name: BACKEND_LABEL });
      expect(trigger).toHaveTextContent("pgvector");

      await user.click(trigger);
      await user.click(screen.getByRole("option", { name: "Pinecone" }));

      expect(onChange).toHaveBeenLastCalledWith("pinecone");
    });

    it("only offers the field's declared options, never free text", async () => {
      const user = userEvent.setup();
      render(
        <ConfigFieldControl
          field={makeBackendField()}
          value="pgvector"
          onChange={vi.fn()}
          onReset={vi.fn()}
          resetting={false}
        />,
      );

      await user.click(screen.getByRole("combobox", { name: BACKEND_LABEL }));

      expect(screen.getAllByRole("option")).toHaveLength(2);
    });
  });

  describe("multi_select field", () => {
    const CONTENT_TYPES_LABEL = "Auto-ingested content types";

    function makeContentTypesField(overrides: Parameters<typeof makeConfigField>[0] = {}) {
      return makeConfigField({
        key: "uploads.allowed_content_types",
        label: CONTENT_TYPES_LABEL,
        kind: "multi_select",
        options: [
          { value: TEXT_PLAIN, label: PLAIN_TEXT_LABEL },
          { value: APPLICATION_PDF, label: PDF_LABEL },
        ],
        value: [TEXT_PLAIN],
        default: [TEXT_PLAIN],
        ...overrides,
      });
    }

    it("checks only the currently-selected options", () => {
      render(
        <ConfigFieldControl
          field={makeContentTypesField()}
          value={[TEXT_PLAIN]}
          onChange={vi.fn()}
          onReset={vi.fn()}
          resetting={false}
        />,
      );

      expect(screen.getByRole("checkbox", { name: PLAIN_TEXT_LABEL })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: PDF_LABEL })).not.toBeChecked();
    });

    it("adds a value to the list when its checkbox is checked", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <ConfigFieldControl
          field={makeContentTypesField()}
          value={[TEXT_PLAIN]}
          onChange={onChange}
          onReset={vi.fn()}
          resetting={false}
        />,
      );

      await user.click(screen.getByRole("checkbox", { name: PDF_LABEL }));

      expect(onChange).toHaveBeenLastCalledWith([TEXT_PLAIN, APPLICATION_PDF]);
    });

    it("removes a value from the list when its checkbox is unchecked", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <ConfigFieldControl
          field={makeContentTypesField()}
          value={[TEXT_PLAIN]}
          onChange={onChange}
          onReset={vi.fn()}
          resetting={false}
        />,
      );

      await user.click(screen.getByRole("checkbox", { name: PLAIN_TEXT_LABEL }));

      expect(onChange).toHaveBeenLastCalledWith([]);
    });
  });

  describe("bounded int field", () => {
    it("surfaces min/max on the input and in the hint text", () => {
      const field = makeIntField({ min_value: 1, max_value: 1024 });

      render(
        <ConfigFieldControl
          field={field}
          value={50}
          onChange={vi.fn()}
          onReset={vi.fn()}
          resetting={false}
        />,
      );

      const input = screen.getByLabelText(MAX_UPLOAD_LABEL) as HTMLInputElement;
      expect(input).toHaveAttribute("min", "1");
      expect(input).toHaveAttribute("max", "1024");
      expect(screen.getByText(/Allowed range: 1–1024/)).toBeInTheDocument();
    });
  });
});
