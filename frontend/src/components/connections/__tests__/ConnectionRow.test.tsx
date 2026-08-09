import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConnectionRow } from "@/components/connections/ConnectionRow";
import * as apiModule from "@/lib/api";
import { makeConnection } from "@/test/fixtures";

const VALIDATE_BUTTON = /Validate/;
const CONNECTED = "Connected.";
const OLLAMA_ROW = { label: "Ollama", provider_type: "ollama" } as const;

vi.mock("@/lib/api", () => ({ validateConnection: vi.fn() }));

const api = vi.mocked(apiModule);

function renderRow(overrides: { syncError?: string | null } = {}) {
  return render(
    <ConnectionRow
      connection={makeConnection({
        label: "Ollama",
        provider_type: "ollama",
        kinds: ["embedding", "chat"],
        config: { base_url: "http://host.docker.internal:11434" },
      })}
      providerLabel="Ollama"
      authToken="token"
      onEdit={() => {}}
      onValidated={() => {}}
      onRemove={() => {}}
      removing={false}
      {...overrides}
    />,
  );
}

describe("ConnectionRow", () => {
  it("lays itself out against its container, not the viewport", () => {
    const { container } = renderRow();
    const row = container.firstElementChild as HTMLElement;

    // The row renders both on the wide settings page and inside the setup
    // wizard's narrow step card. A viewport breakpoint makes the narrow card
    // render the wide single-line layout, which squeezes the name column to
    // zero width; container variants keep the two sites independent.
    expect(row.className).toContain("@3xl:flex-row");
    expect(row.className).not.toMatch(/(^|\s)lg:/);
    expect(row.className).toContain("flex-col");
  });

  it("keeps the name column shrinkable and the trailing cells fixed", () => {
    renderRow();
    const label = screen.getByText("Ollama", { selector: "span" });
    const nameColumn = label.closest("div.min-w-0")?.parentElement as HTMLElement;

    expect(nameColumn.className).toContain("min-w-0");
    expect(nameColumn.className).toContain("flex-1");
    // Chips and actions never absorb the row's slack — only the name column does.
    const actions = screen.getByRole("button", { name: "Validate Ollama" })
      .parentElement as HTMLElement;
    expect(actions.className).toContain("shrink-0");
  });

  it("states why the last model listing failed, without waiting to be validated", () => {
    renderRow({ syncError: "[Errno 113] No route to host" });

    // The picker links here to fix a connection it just reported as down, so
    // the row must arrive already saying so rather than looking healthy.
    expect(screen.getByText("Unreachable: [Errno 113] No route to host")).toBeInTheDocument();
  });

  it("lets a successful validation replace a stale sync failure", async () => {
    api.validateConnection.mockResolvedValue({ valid: true, message: CONNECTED });
    renderRow({ syncError: "[Errno 113] No route to host" });

    await userEvent.click(screen.getByRole("button", { name: "Validate Ollama" }));

    // The user pressed Validate to find out the current state; reporting the
    // older failure over their own check reads as the fix not working.
    await waitFor(() => expect(screen.getByText(CONNECTED)).toBeInTheDocument());
    expect(screen.queryByText(/No route to host/)).not.toBeInTheDocument();
  });
});

it("reports a successful validate so the list picks up the new verified stamp", async () => {
  const user = userEvent.setup();
  const onValidated = vi.fn();
  api.validateConnection.mockResolvedValueOnce({ valid: true, message: CONNECTED });
  render(
    <ConnectionRow
      connection={makeConnection(OLLAMA_ROW)}
      providerLabel="Ollama"
      authToken="token"
      onEdit={() => {}}
      onValidated={onValidated}
      onRemove={() => {}}
      removing={false}
    />,
  );

  await user.click(screen.getByRole("button", { name: VALIDATE_BUTTON }));

  expect(await screen.findByText(CONNECTED)).toBeVisible();
  // Validating is what stamps `last_validated_at`; without a refetch the row
  // turns green while every capability gate still reads it as never reached.
  expect(onValidated).toHaveBeenCalled();
});

it("does not report a failed validate as a change worth refetching", async () => {
  const user = userEvent.setup();
  const onValidated = vi.fn();
  api.validateConnection.mockResolvedValueOnce({ valid: false, message: "Connection refused." });
  render(
    <ConnectionRow
      connection={makeConnection(OLLAMA_ROW)}
      providerLabel="Ollama"
      authToken="token"
      onEdit={() => {}}
      onValidated={onValidated}
      onRemove={() => {}}
      removing={false}
    />,
  );

  await user.click(screen.getByRole("button", { name: VALIDATE_BUTTON }));

  await screen.findByText("Connection refused.");
  expect(onValidated).not.toHaveBeenCalled();
});
