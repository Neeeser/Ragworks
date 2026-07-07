import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ModalOverlay } from "@/components/ui/modal-overlay";

function NestedHarness({
  onCloseOuter,
  onCloseInner,
}: {
  onCloseOuter: () => void;
  onCloseInner: () => void;
}) {
  const [innerOpen, setInnerOpen] = useState(true);
  return (
    <>
      <ModalOverlay open onClose={onCloseOuter}>
        <div>Outer content</div>
      </ModalOverlay>
      <ModalOverlay
        open={innerOpen}
        onClose={() => {
          onCloseInner();
          setInnerOpen(false);
        }}
      >
        <div>Inner content</div>
      </ModalOverlay>
    </>
  );
}

function FocusRestoreHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ModalOverlay open={open} onClose={() => setOpen(false)}>
        <button type="button">Inside dialog</button>
      </ModalOverlay>
    </div>
  );
}

function Harness({
  open,
  onClose,
  closeOnBackdrop,
}: {
  open: boolean;
  onClose: () => void;
  closeOnBackdrop?: boolean;
}) {
  return (
    <div>
      <button type="button">Outside trigger</button>
      <ModalOverlay open={open} onClose={onClose} closeOnBackdrop={closeOnBackdrop}>
        <div>
          <button type="button">First</button>
          <button type="button">Second</button>
        </div>
      </ModalOverlay>
    </div>
  );
}

describe("ModalOverlay", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ModalOverlay open={false} onClose={() => {}}>
        content
      </ModalOverlay>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a dialog with role and aria-modal when open", () => {
    render(
      <ModalOverlay open onClose={() => {}}>
        content
      </ModalOverlay>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("closes on Escape only while open", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalOverlay open={false} onClose={onClose}>
        content
      </ModalOverlay>,
    );
    // Escape while closed should not call onClose (listener not attached)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <ModalOverlay open onClose={onClose}>
        content
      </ModalOverlay>,
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes only the topmost overlay when nested", () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    render(<NestedHarness onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />);

    expect(screen.getByText("Inner content")).toBeInTheDocument();

    // First Escape: only the inner (topmost) overlay closes; the outer's listener
    // sees it is not at the top of the stack and ignores the same event.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
    expect(screen.queryByText("Inner content")).not.toBeInTheDocument();
    expect(screen.getByText("Outer content")).toBeInTheDocument();

    // Second Escape: the outer overlay is now topmost and closes.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseOuter).toHaveBeenCalledTimes(1);
    expect(onCloseInner).toHaveBeenCalledTimes(1);
  });

  it("backdrop click on the inner overlay does not close the outer overlay", async () => {
    const user = userEvent.setup();
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    render(<NestedHarness onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />);

    // The inner overlay's backdrop is a separate fixed inset-0 layer covering the
    // outer one, so a backdrop click only reaches (and closes) the inner overlay.
    const backdrops = screen.getAllByRole("presentation");
    await user.click(backdrops[backdrops.length - 1]);
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
    expect(screen.getByText("Outer content")).toBeInTheDocument();
  });

  it("closes on backdrop click but not on content click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ModalOverlay open onClose={onClose}>
        <button type="button">Inside</button>
      </ModalOverlay>,
    );

    await user.click(screen.getByText("Inside"));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on backdrop click when closeOnBackdrop is false", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ModalOverlay open onClose={onClose} closeOnBackdrop={false}>
        <div>content</div>
      </ModalOverlay>,
    );

    await user.click(screen.getByRole("presentation"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog on open and restores it on close", async () => {
    const user = userEvent.setup();
    render(<FocusRestoreHarness />);

    const openButton = screen.getByText("Open");
    openButton.focus();
    expect(document.activeElement).toBe(openButton);

    await user.click(openButton);
    expect(document.activeElement).toBe(screen.getByText("Inside dialog"));

    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(openButton);
  });

  it("wraps focus with Tab between first and last focusable elements", async () => {
    const user = userEvent.setup();
    render(<Harness open onClose={() => {}} />);

    const first = screen.getByText("First");
    const second = screen.getByText("Second");

    first.focus();
    expect(document.activeElement).toBe(first);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(second);

    second.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);
  });

  it("locks body scroll while open and restores afterwards", () => {
    const { rerender, unmount } = render(
      <ModalOverlay open={false} onClose={() => {}}>
        content
      </ModalOverlay>,
    );
    expect(document.body.style.overflow).not.toBe("hidden");

    rerender(
      <ModalOverlay open onClose={() => {}}>
        content
      </ModalOverlay>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("wires aria-labelledby to the given id", () => {
    render(
      <ModalOverlay open onClose={() => {}} labelledBy="my-title">
        content
      </ModalOverlay>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-labelledby", "my-title");
  });
});
