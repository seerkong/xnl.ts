import { describe, expect, it } from "vitest";
import { IndexedDbVfsPersistence } from "../src/indexeddb-persistence";

describe("indexeddb vfs persistence", () => {
  it("throws clear error when indexeddb is unavailable", async () => {
    const persistence = new IndexedDbVfsPersistence({
      indexedDbFactory: undefined,
    });

    await expect(persistence.loadSnapshot()).rejects.toThrowError(
      "IndexedDB is unavailable in this runtime. Pass indexedDbFactory to IndexedDbVfsPersistenceOptions in non-browser environments.",
    );
  });
});
