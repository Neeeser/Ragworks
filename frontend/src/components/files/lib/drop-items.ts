// Turn a drop event's DataTransfer into upload entries, preserving folder
// structure via each file's path relative to the drop root (the shape the
// upload endpoint's `relative_path` field expects).

export interface DroppedUpload {
  file: File;
  relativePath: string | null;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (resolve: (file: File) => void, reject: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      resolve: (entries: FileSystemEntryLike[]) => void,
      reject: (error: unknown) => void,
    ) => void;
  };
}

function entryFile(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file?.(resolve, reject));
}

async function readAllEntries(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader?.();
  if (!reader) {
    return [];
  }
  const all: FileSystemEntryLike[] = [];
  // readEntries returns results in batches; keep reading until it runs dry.
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) {
      return all;
    }
    all.push(...batch);
  }
}

async function collectEntry(entry: FileSystemEntryLike, results: DroppedUpload[]): Promise<void> {
  if (entry.isFile) {
    const file = await entryFile(entry);
    const relativePath = entry.fullPath.replace(/^\//, "");
    results.push({ file, relativePath: relativePath.includes("/") ? relativePath : null });
    return;
  }
  if (entry.isDirectory) {
    for (const child of await readAllEntries(entry)) {
      await collectEntry(child, results);
    }
  }
}

/** Extract files (and folder trees) from a drop's DataTransfer. */
export async function collectDroppedUploads(dataTransfer: DataTransfer): Promise<DroppedUpload[]> {
  const results: DroppedUpload[] = [];
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map((item) =>
      "webkitGetAsEntry" in item ? (item.webkitGetAsEntry() as FileSystemEntryLike | null) : null,
    )
    .filter((entry): entry is FileSystemEntryLike => entry !== null);

  if (entries.length > 0) {
    for (const entry of entries) {
      await collectEntry(entry, results);
    }
    return results;
  }
  // Fallback for browsers without the entries API: plain files, no folders.
  return Array.from(dataTransfer.files ?? []).map((file) => ({ file, relativePath: null }));
}
