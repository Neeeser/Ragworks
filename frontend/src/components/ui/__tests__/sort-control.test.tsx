import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SortControl } from "@/components/ui/sort-control";

describe("SortControl", () => {
  it("selects a caller-defined field and reverses the direction", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onDirectionChange = vi.fn();

    render(
      <SortControl
        label="Sort chunks"
        value="chunk_number"
        direction="asc"
        options={[
          { value: "chunk_number", label: "Chunk number" },
          { value: "tokens", label: "Tokens" },
        ]}
        onValueChange={onValueChange}
        onDirectionChange={onDirectionChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Sort chunks" }));
    await user.click(screen.getByRole("option", { name: "Tokens" }));
    await user.click(screen.getByRole("button", { name: "Sort descending" }));

    expect(onValueChange).toHaveBeenCalledWith("tokens");
    expect(onDirectionChange).toHaveBeenCalledWith("desc");
  });
});
