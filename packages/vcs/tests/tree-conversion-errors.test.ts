import { describe, expect, it } from "vitest";
import { VirtualFileSystem } from "xnl-vfs";
import { VcsError } from "../src/errors";
import { MemoryObjectStore } from "../src/object-store";
import { MemoryContentStore } from "../src/content-store";
import { checkoutTree } from "../src/tree-converter";

describe("tree conversion errors", () => {
  it("throws ENOENT_OBJECT for unknown tree id", () => {
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();
    const vfs = new VirtualFileSystem();

    expect(() => checkoutTree("unknown-tree-id", vfs, store, contentStore)).toThrowError(VcsError);
    try {
      checkoutTree("unknown-tree-id", vfs, store, contentStore);
    } catch (err) {
      expect((err as VcsError).code).toBe("ENOENT_OBJECT");
    }
  });
});
