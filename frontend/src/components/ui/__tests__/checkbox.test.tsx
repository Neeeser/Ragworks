import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Checkbox, CheckboxBox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("CheckboxBox", () => {
  it("conveys checked state and toggles by keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckboxBox checked={false} onChange={onChange} aria-label="Enable telemetry" />);

    const box = screen.getByRole("checkbox", { name: "Enable telemetry" });
    expect(box).not.toBeChecked();

    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("keeps a disabled option readable as checked", () => {
    // An implied MCP capability renders checked-and-locked. Dimming the glyph
    // along with the box is how that comes to read as "not granted".
    render(<CheckboxBox checked disabled onChange={vi.fn()} aria-label="Read files" />);

    const box = screen.getByRole("checkbox", { name: "Read files" });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
  });

  it("takes the id and description Field wires onto its control", () => {
    render(
      <Field label="Enable telemetry" hint="Local only.">
        <CheckboxBox checked onChange={vi.fn()} />
      </Field>,
    );

    const box = screen.getByRole("checkbox", { name: "Enable telemetry" });
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription("Local only.");
  });
});

describe("Checkbox", () => {
  it("toggles by clicking its label and exposes its description", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox
        checked={false}
        onChange={onChange}
        label="Add a count tool"
        description="Counts matching documents."
      />,
    );

    const box = screen.getByRole("checkbox", { name: "Add a count tool" });
    expect(box).toHaveAccessibleDescription("Counts matching documents.");

    await user.click(screen.getByText("Add a count tool"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("the checkbox primitive is the only one", () => {
  it("has no hand-rolled checkbox inputs anywhere else in src", async () => {
    // A bare input styled with `accent-color` plus a custom background drops
    // the browser's own checkmark, so the box reads the same on and off. The
    // sweep is what stops the next copy from reintroducing that.
    const { globSync } = await import("tinyglobby");
    const files = globSync(["**/*.tsx"], {
      cwd: SRC_DIR,
      ignore: ["**/__tests__/**", "components/ui/checkbox.tsx"],
    });

    // Without this the sweep passes vacuously the moment the glob breaks.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.filter((file) =>
      readFileSync(path.join(SRC_DIR, file), "utf8").includes('type="checkbox"'),
    );

    expect(offenders).toEqual([]);
  });
});
