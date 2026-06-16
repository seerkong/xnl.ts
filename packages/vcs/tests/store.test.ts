import { describe, expect, it } from "vitest";
import { MemoryObjectStore } from "../src/object-store";
import type { BlobObject } from "../src/types";

describe("memory object store", () => {
  it("supports put/get/has/list", () => {
    const store = new MemoryObjectStore();
    const blob: BlobObject = {
      type: "blob",
      fileType: "text",
      contentRef: "abc123",
      contentType: "text",
      contentHash: "abc123",
      size: 5,
    };

    const id = store.put(blob);
    expect(store.has(id)).toBe(true);
    expect(store.get(id)).toEqual(blob);
    expect(store.list()).toContain(id);
  });

  it("returns null for missing object", () => {
    const store = new MemoryObjectStore();
    expect(store.get("missing")).toBeNull();
  });
});
