import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilesBrowser } from "@/components/files/FilesBrowser";
import * as apiModule from "@/lib/api";
import { makeFileNode, makeFileTree, makeFolderNode } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const TOKEN = "token-1";
const DOC_NAME = "doc.txt";
const DOC_ID = "file-doc";
const DEST_NAME = "dest";
const DEST_ID = "folder-dest";
const DRAGGABLE = "[draggable]";
const docNode = makeFileNode({ id: DOC_ID, name: DOC_NAME, path: "/doc.txt" });
const folderNode = makeFolderNode({ id: DEST_ID, name: DEST_NAME, path: "/dest" });

function renderBrowser() {
  return render(
    <FilesBrowser token={TOKEN} collectionId="col-1" collectionName="Docs" pathSegments={[]} />,
  );
}

/** jsdom has no DataTransfer; a minimal stand-in for internal node drags. */
function makeDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    get types() {
      return Array.from(data.keys());
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "all",
    dropEffect: "none",
  } as unknown as DataTransfer;
}

async function openMenuOn(name: string) {
  fireEvent.contextMenu(await screen.findByTitle(name));
  return screen.findByRole("menu");
}

beforeEach(() => {
  api.fetchFileTree.mockResolvedValue(makeFileTree({ nodes: [docNode, folderNode] }));
});

describe("FilesBrowser right-click actions", () => {
  it("copying a file and pasting on the background duplicates it into the current folder", async () => {
    const user = userEvent.setup();
    renderBrowser();

    await openMenuOn(DOC_NAME);
    await user.click(screen.getByRole("menuitem", { name: "Copy" }));

    fireEvent.contextMenu(screen.getByText(/Name/i).closest("div")!.parentElement!);
    const paste = await screen.findByRole("menuitem", { name: /Paste/ });
    await user.click(paste);

    await waitFor(() => expect(api.copyFileNode).toHaveBeenCalledWith(TOKEN, DOC_ID, null));
  });

  it("cutting a file and pasting into a folder moves it and empties the clipboard", async () => {
    const user = userEvent.setup();
    renderBrowser();

    await openMenuOn(DOC_NAME);
    await user.click(screen.getByRole("menuitem", { name: "Cut" }));

    await openMenuOn(DEST_NAME);
    await user.click(screen.getByRole("menuitem", { name: /Paste/ }));

    await waitFor(() =>
      expect(api.updateFileNode).toHaveBeenCalledWith(TOKEN, DOC_ID, {
        parent_id: DEST_ID,
      }),
    );

    // Clipboard consumed: a fresh menu's Paste is disabled again.
    await openMenuOn(DEST_NAME);
    expect(screen.getByRole("menuitem", { name: /Paste/ })).toBeDisabled();
  });

  it("renaming through the dialog sends the new name", async () => {
    const user = userEvent.setup();
    renderBrowser();

    await openMenuOn(DOC_NAME);
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByLabelText("Name");
    await user.clear(input);
    await user.type(input, "renamed.txt");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(api.updateFileNode).toHaveBeenCalledWith(TOKEN, DOC_ID, {
        name: "renamed.txt",
      }),
    );
  });

  it("deleting asks for confirmation before calling the API", async () => {
    const user = userEvent.setup();
    renderBrowser();

    await openMenuOn(DOC_NAME);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(api.deleteFileNode).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.deleteFileNode).toHaveBeenCalledWith(TOKEN, DOC_ID));
  });
});

describe("FilesBrowser drag-and-drop moves", () => {
  it("dropping a file onto a folder moves it there", async () => {
    renderBrowser();
    const fileTile = (await screen.findByTitle(DOC_NAME)).closest(DRAGGABLE)!;
    const folderTile = (await screen.findByTitle(DEST_NAME)).closest(DRAGGABLE)!;

    const dataTransfer = makeDataTransfer();
    await act(async () => {
      fireEvent.dragStart(fileTile, { dataTransfer });
      fireEvent.dragOver(folderTile, { dataTransfer });
      fireEvent.drop(folderTile, { dataTransfer });
    });

    await waitFor(() =>
      expect(api.updateFileNode).toHaveBeenCalledWith(TOKEN, DOC_ID, {
        parent_id: DEST_ID,
      }),
    );
  });

  it("an OS-file drag is not treated as an internal move", async () => {
    renderBrowser();
    const folderTile = (await screen.findByTitle(DEST_NAME)).closest(DRAGGABLE)!;

    // OS drags carry Files, never the internal node type.
    const dataTransfer = {
      types: ["Files"],
      getData: () => "",
      setData: () => undefined,
      dropEffect: "none",
      effectAllowed: "all",
    } as unknown as DataTransfer;
    await act(async () => {
      fireEvent.dragOver(folderTile, { dataTransfer });
      fireEvent.drop(folderTile, { dataTransfer });
    });

    expect(api.updateFileNode).not.toHaveBeenCalled();
  });
});
