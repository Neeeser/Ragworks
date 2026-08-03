import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeVectorIndex } from "@/test/fixtures";

import { IndexSourceField } from "../IndexSourceField";

import type { VectorIndex } from "@/lib/types";

const MISMATCHED_INDEX_NAME = "legacy-index";
const matchingIndex = makeVectorIndex({ name: "current-index", dimension: 384 });
const mismatchedIndex = makeVectorIndex({ name: MISMATCHED_INDEX_NAME, dimension: 768 });
const mismatchedOptionLabel = `${MISMATCHED_INDEX_NAME} · 768d · won't accept 384d`;

const openIndexSelect = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("combobox", { name: "Vector index" }));
};

const renderField = (
  overrides: Partial<Parameters<typeof IndexSourceField>[0]> = {},
  indexes: VectorIndex[] = [matchingIndex, mismatchedIndex],
) => {
  const onPickIndex = vi.fn();
  render(
    <IndexSourceField
      indexes={indexes}
      backend="pgvector"
      indexValue=""
      variableName={null}
      variables={[]}
      expectedDimension={384}
      onPickIndex={onPickIndex}
      onBindVariable={vi.fn()}
      onDeclareVariable={vi.fn()}
      {...overrides}
    />,
  );
  return { onPickIndex };
};

describe("IndexSourceField", () => {
  it("marks an index whose dimension doesn't match the upstream embedder, leaving a matching one plain", async () => {
    const user = userEvent.setup();
    renderField();
    await openIndexSelect(user);

    expect(screen.getByRole("option", { name: "current-index · 384d" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: mismatchedOptionLabel })).toBeInTheDocument();
  });

  it("does not mark any index when the upstream width is unknown", async () => {
    const user = userEvent.setup();
    renderField({ expectedDimension: null });
    await openIndexSelect(user);

    expect(screen.getByRole("option", { name: "legacy-index · 768d" })).toBeInTheDocument();
    expect(screen.queryByText(/won't accept/)).not.toBeInTheDocument();
  });

  it("keeps an incompatible index selectable rather than filtering it out of the list", async () => {
    const user = userEvent.setup();
    const { onPickIndex } = renderField();
    await openIndexSelect(user);
    await user.click(screen.getByRole("option", { name: mismatchedOptionLabel }));

    expect(onPickIndex).toHaveBeenCalledWith(MISMATCHED_INDEX_NAME);
  });

  it("states both dimensions in plain language when the selected index is incompatible", () => {
    renderField({ indexValue: MISMATCHED_INDEX_NAME });

    expect(
      screen.getByText(
        "Produces 384-dimension vectors; this index stores 768. This node will fail until they match.",
      ),
    ).toBeInTheDocument();
  });

  it("shows no mismatch message when the selected index matches the upstream width", () => {
    renderField({ indexValue: "current-index" });

    expect(screen.queryByText(/This node will fail until they match/)).not.toBeInTheDocument();
  });
});
