import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConnectionConfigFields } from "@/components/connections/ConnectionConfigFields";
import { makeProviderConfigField } from "@/test/fixtures/providers";

describe("ConnectionConfigFields", () => {
  it("lets users reveal and hide a secret without changing its value", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionConfigFields
        fields={[
          makeProviderConfigField({ name: "api_key", label: "API key", kind: "secret" }),
        ]}
        config={{ api_key: "secret-value" }}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("API key");

    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show secret: api_key" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("secret-value");
    await user.click(screen.getByRole("button", { name: "Hide secret: api_key" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("renders provider constraints from config field descriptions", () => {
    render(
      <ConnectionConfigFields
        fields={[
          makeProviderConfigField({
            name: "base_url",
            label: "Server URL",
            kind: "url",
            description: "Each TEI connection serves one model and task.",
          }),
        ]}
        config={{}}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Each TEI connection serves one model and task.")).toBeInTheDocument();
  });
});
