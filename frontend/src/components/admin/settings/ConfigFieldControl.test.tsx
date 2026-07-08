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
});
