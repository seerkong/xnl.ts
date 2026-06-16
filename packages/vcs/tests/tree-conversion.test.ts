import { describe, expect, it } from "vitest";
import { MemoryObjectStore } from "../src/object-store";
import { MemoryContentStore } from "../src/content-store";
import { buildTree, checkoutTree } from "../src/tree-converter";
import { VirtualFileSystem } from "xnl-vfs";

describe("tree conversion", () => {
  it("preserves structure, content, file types, and extension tags", () => {
    const source = new VirtualFileSystem();
    source.mkdir("vfs:///src/components", { recursive: true });
    source.mkdir("vfs:///src/assets", { recursive: true });
    source.writeFile("vfs:///src/main.ts", "export const app = 1;", { fileType: "text" });
    source.writeFile("vfs:///src/layout.xnl", `<layout id="layout1" [ <header> ]>`, {
      fileType: "xnl",
      extend: {
        order: ["ViewExt"],
        children: {
          ViewExt: { kind: "DataElement", tag: "ViewExt", metadata: { visible: true } },
        },
      },
    });
    source.writeFile("vfs:///src/assets/logo.bin", "BINARY_PAYLOAD", { fileType: "binary" });

    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();
    const treeId = buildTree(source, store, contentStore);

    const target = new VirtualFileSystem();
    checkoutTree(treeId, target, store, contentStore);

    expect(target.getSnapshot()).toEqual(source.getSnapshot());
  });
});
