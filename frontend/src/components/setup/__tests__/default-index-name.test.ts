import { describe, expect, it } from "vitest";

import { defaultIndexName } from "@/components/setup/lib/default-index-name";

/** The strict rule shared by every backend, and the BM25 sibling's suffix. */
const INDEX_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX = 45;
const bm25 = (name: string) => `${name}-bm25`;
const ID = "780c25bf-c33d-45cd-8eb1-f898752f6f68";

describe("defaultIndexName", () => {
  it("carries the account so two users never start on the same index", () => {
    const one = defaultIndexName({ id: ID, email: "andrew@example.com" }, MAX);
    const two = defaultIndexName(
      { id: "9a1e77d4-0b21-4c8e-9d3a-5f0c2e11b7aa", email: "andrew@other.com" },
      MAX,
    );

    expect(one).toBe("ragworks-andrew-780c25bf");
    expect(one).not.toBe(two);
  });

  it("keeps the name and its BM25 sibling inside the backend's length rule", () => {
    // A long local part is the case that overruns: the name has to be cut so
    // that `<name>-bm25` still fits, or the sibling is silently truncated.
    const name = defaultIndexName(
      {
        id: ID,
        email: `${"averyverylongmailboxname".repeat(3)}@example.com`,
      },
      MAX,
    );

    expect(name).toMatch(INDEX_NAME);
    expect(bm25(name).length).toBeLessThanOrEqual(MAX);
    expect(bm25(name)).toMatch(INDEX_NAME);
  });

  it("produces a valid name from an address with no usable characters", () => {
    const name = defaultIndexName({ id: ID, email: "+._-@example.com" }, MAX);

    expect(name).toBe("ragworks-780c25bf");
    expect(name).toMatch(INDEX_NAME);
  });

  it("never ends on a separator, which the name rule rejects", () => {
    const name = defaultIndexName({ id: ID, email: "andrew.@example.com" }, MAX);

    expect(name).toMatch(INDEX_NAME);
    expect(name.endsWith("-")).toBe(false);
  });

  it("never doubles a separator when the local part is cut mid-word", () => {
    // The cut can land on a hyphen; joining that to the id suffix would read
    // as `…--780c25bf`.
    const name = defaultIndexName(
      {
        id: ID,
        // Slugifies to `aa-bbb-cccc-ddddd-eee-zz`, whose 22-character cut —
        // the budget left once the prefix and id suffix are reserved — lands
        // exactly on a hyphen.
        email: "aa.bbb.cccc.ddddd.eee.zz@example.com",
      },
      MAX,
    );

    expect(name).toMatch(INDEX_NAME);
    expect(name).not.toMatch(/--/);
    expect(bm25(name).length).toBeLessThanOrEqual(MAX);
  });

  it("respects a tighter limit than the shared 45-character rule", () => {
    const name = defaultIndexName({ id: ID, email: "andrew@example.com" }, 24);

    expect(name).toMatch(INDEX_NAME);
    expect(bm25(name).length).toBeLessThanOrEqual(24);
  });
});
