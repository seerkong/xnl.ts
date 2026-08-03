import { IDBFactory } from "fake-indexeddb";
import { parseXnl, type DataElementNode } from "xnl-core";
import { describe, expect, it } from "vitest";
import {
  createIndexedDbRevisionedVfsAuthority,
  type IndexedDbRevisionedVfsAuthorityOptions,
  type RevisionedVfsAuthority,
} from "xnl-vfs/revisioned-persistence";

describe("revisioned persistence public package entry", () => {
  it("exports a consumable IndexedDB authority factory and public types", async () => {
    const initialSnapshot = parseXnl(
      `<workspace #workspace state="public-entry">`,
    ).nodes[0] as DataElementNode;
    const options: IndexedDbRevisionedVfsAuthorityOptions = {
      authorityId: "public-entry-authority",
      initialSnapshot,
      indexedDbFactory: new IDBFactory(),
    };
    const authority: RevisionedVfsAuthority =
      await createIndexedDbRevisionedVfsAuthority(options);

    await expect(authority.read()).resolves.toMatchObject({
      revision: {
        authorityId: "public-entry-authority",
        value: "revision:0",
      },
      snapshot: { metadata: { state: "public-entry" } },
    });
  });
});
