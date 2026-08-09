import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UploadDatasetDialog } from "@/components/evals/UploadDatasetDialog";

// jsdom's File has no .text(); the component reads content through it.
function mkFile(content: string, name: string): File {
  const file = new File([content], name);
  Object.defineProperty(file, "text", { value: async () => content });
  return file;
}

async function fillDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "QA set");
  // The file inputs are visually-hidden inside their "Choose file" labels, so
  // they carry no per-part accessible name to query by.
  const fileInputs = [...document.querySelectorAll<HTMLInputElement>("input[type=file]")];
  await user.upload(fileInputs[0], mkFile('{"_id":"d1"}', "corpus.jsonl"));
  await user.upload(fileInputs[1], mkFile('{"_id":"q1","text":"q"}', "queries.jsonl"));
  await user.upload(fileInputs[2], mkFile("q1\td1\t1", "qrels.tsv"));
  // readFile awaits file.text() before committing state; wait for the last
  // filename to render so Upload is enabled before clicking it.
  await screen.findByText("qrels.tsv");
}

describe("UploadDatasetDialog", () => {
  it("shows a rejected upload's error inside the dialog and stays open", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn(async () => "Every corpus row needs a non-empty 'text' (row 'd2').");
    const onClose = vi.fn();
    render(<UploadDatasetDialog open onUpload={onUpload} onClose={onClose} />);

    await fillDialog(user);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Every corpus row needs a non-empty 'text' (row 'd2').",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears the previous error and closes once a retry succeeds", async () => {
    const user = userEvent.setup();
    const onUpload = vi
      .fn<(payload: unknown) => Promise<string | null>>()
      .mockResolvedValueOnce("Malformed JSON in corpus file.")
      .mockResolvedValueOnce(null);
    const onClose = vi.fn();
    render(<UploadDatasetDialog open onUpload={onUpload} onClose={onClose} />);

    await fillDialog(user);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });
});
