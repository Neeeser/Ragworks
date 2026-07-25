import { act, fireEvent, render, screen } from "@testing-library/react";
import { FolderTree, Settings } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavRail } from "@/components/ui/nav-rail";
import * as apiModule from "@/lib/api";
import { clearRailPreviewsForUser } from "@/lib/rail-preview-cache";
import { makeCollection, USER_ID } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const links = [
  { href: "/collections", label: "Collections", icon: FolderTree },
  // Not a previewed section, so this one keeps the plain tooltip.
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Past the 70ms pointer-intent delay, then far enough through the microtask
 * queue for the lazy load to land. `waitFor` cannot be used here: it polls on
 * timers, which are faked.
 */
async function settle(ms = 80) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function railItem(name: string): { link: HTMLElement; wrapper: HTMLElement } {
  const link = screen.getByRole("link", { name });
  return { link, wrapper: link.parentElement as HTMLElement };
}

describe("NavRail flyouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRailPreviewsForUser(USER_ID);
    api.fetchCollections.mockResolvedValue([
      makeCollection({ id: "col-1", name: "Alpha" }),
      makeCollection({ id: "col-2", name: "Beta" }),
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches nothing until a flyout is opened", () => {
    render(<NavRail links={links} activeHref="/collections" />);
    expect(api.fetchCollections).not.toHaveBeenCalled();
  });

  it("opens on hover after the intent delay and lists the section's destinations", async () => {
    render(<NavRail links={links} activeHref="/collections" />);

    const { wrapper } = railItem("Collections");
    fireEvent.pointerEnter(wrapper);
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();

    await settle();
    expect(
      screen.getByText("Document corpora, each bound to an ingestion and a retrieval pipeline."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Alpha/ })).toHaveAttribute(
      "href",
      "/collections/col-1",
    );
    expect(screen.getByRole("link", { name: /Beta/ })).toHaveAttribute(
      "href",
      "/collections/col-2",
    );
  });

  it("reuses the loaded preview when the same flyout is opened again", async () => {
    render(<NavRail links={links} activeHref="/collections" />);

    const { wrapper } = railItem("Collections");
    fireEvent.pointerEnter(wrapper);
    await settle();
    expect(screen.getByRole("link", { name: /Alpha/ })).toBeInTheDocument();

    fireEvent.pointerLeave(wrapper);
    await settle(200);
    expect(screen.queryByRole("link", { name: /Alpha/ })).not.toBeInTheDocument();

    fireEvent.pointerEnter(wrapper);
    await settle();
    expect(screen.getByRole("link", { name: /Alpha/ })).toBeInTheDocument();
    expect(api.fetchCollections).toHaveBeenCalledTimes(1);
  });

  it("opens on keyboard focus, and Escape closes it and returns focus to the rail", async () => {
    render(<NavRail links={links} activeHref="/collections" />);
    const { link: railLink } = railItem("Collections");

    await act(async () => {
      railLink.focus();
    });
    await settle(0);
    expect(screen.getByRole("link", { name: /Alpha/ })).toBeInTheDocument();
    expect(railLink).toHaveAttribute("aria-describedby");

    fireEvent.keyDown(railLink, { key: "Escape" });
    await settle(0);
    expect(screen.queryByRole("link", { name: /Alpha/ })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(railLink);
  });

  it("closes on Escape pressed from inside the panel, without the refocus reopening it", async () => {
    render(<NavRail links={links} activeHref="/collections" />);
    const { link: railLink } = railItem("Collections");

    await act(async () => {
      railLink.focus();
    });
    await settle(0);

    // Tab lands on the first destination in the panel; Escape from there has to
    // both close the panel and put focus back on the rail — and returning focus
    // to the rail must not re-trigger the focus-to-open path.
    const destination = screen.getByRole("link", { name: /Alpha/ });
    await act(async () => {
      destination.focus();
    });
    await settle(0);
    expect(destination).toHaveFocus();

    fireEvent.keyDown(destination, { key: "Escape" });
    await settle(0);
    expect(screen.queryByRole("link", { name: /Alpha/ })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(railLink);
  });

  it("shows a visible label and fetches nothing for a section without a preview", async () => {
    render(<NavRail links={links} activeHref="/collections" />);

    // The sidebar names every section without hover; hovering a section with
    // no preview opens nothing and costs nothing.
    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings).toBeVisible();
    fireEvent.pointerEnter(settings);
    await settle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.fetchCollections).not.toHaveBeenCalled();
  });
});
