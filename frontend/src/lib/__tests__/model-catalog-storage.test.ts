import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearStoredCatalogs,
  readStoredCatalog,
  writeStoredCatalog,
} from "@/lib/model-catalog-storage";
import { makeCatalogModel, makeModelCatalog } from "@/test/fixtures";

const USER = "user-1";
const OTHER_USER = "user-2";

describe("the stored model catalog", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("reads back the catalog written for that user and kind", () => {
    const catalog = makeModelCatalog([makeCatalogModel({ id: "gpt-x" })]);
    writeStoredCatalog(USER, "chat", catalog);

    expect(readStoredCatalog(USER, "chat")).toEqual(catalog);
    // Another user's session, or another kind, must never be answered with
    // models that were never theirs.
    expect(readStoredCatalog(OTHER_USER, "chat")).toBeNull();
    expect(readStoredCatalog(USER, "embedding")).toBeNull();
  });

  it("drops every catalog belonging to a user whose session ended", () => {
    writeStoredCatalog(USER, "chat", makeModelCatalog());
    writeStoredCatalog(USER, "embedding", makeModelCatalog());
    writeStoredCatalog(OTHER_USER, "chat", makeModelCatalog());

    clearStoredCatalogs(USER);

    expect(readStoredCatalog(USER, "chat")).toBeNull();
    expect(readStoredCatalog(USER, "embedding")).toBeNull();
    expect(readStoredCatalog(OTHER_USER, "chat")).not.toBeNull();
  });

  it("answers null for an entry that is not a catalog", () => {
    sessionStorage.setItem("ragworks.modelCatalog:user-1:chat", "{ truncated");

    // A cache is not a contract: a half-written entry must not throw its way
    // into the picker's mount effect.
    expect(readStoredCatalog(USER, "chat")).toBeNull();
  });

  it("keeps working when storage refuses the write", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // Over quota the picker just starts empty next load — it never fails the
    // fetch that is about to populate it.
    expect(() => writeStoredCatalog(USER, "chat", makeModelCatalog())).not.toThrow();
    setItem.mockRestore();
  });
});
