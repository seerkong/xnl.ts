import { describe, expect, it } from "vitest";
import { diffVfs, applyVfsMutations } from "../src/mutation-bridge";
import { VirtualFileSystem } from "../src/vfs";

describe("vfs mutation bridge", () => {
  it("roundtrips diff/apply for mixed change set", () => {
    const vfsA = new VirtualFileSystem();
    vfsA.mkdir("vfs:///src", { recursive: true });
    vfsA.writeFile("vfs:///src/a.txt", "a", { fileType: "text" });
    vfsA.writeFile("vfs:///src/b.txt", "b", { fileType: "text" });

    const vfsB = new VirtualFileSystem(vfsA.getSnapshot());
    vfsB.writeFile("vfs:///src/a.txt", "A", { overwrite: true, fileType: "text" });
    vfsB.rename("vfs:///src/b.txt", "vfs:///src/c.txt");
    vfsB.unlink("vfs:///src/c.txt");
    vfsB.writeFile("vfs:///README.md", "readme", { fileType: "text" });

    const a = vfsA.getSnapshot();
    const b = vfsB.getSnapshot();

    const mutations = diffVfs(a, b);
    const applied = applyVfsMutations(a, mutations);
    expect(applied).toEqual(b);
  });

  it("emits move-aware mutations for rename", () => {
    const vfsA = new VirtualFileSystem();
    vfsA.mkdir("vfs:///src", { recursive: true });
    vfsA.mkdir("vfs:///dst", { recursive: true });
    vfsA.writeFile("vfs:///src/a.txt", "a", { fileType: "text" });
    const movedId = vfsA.stat("vfs:///src/a.txt").metadataId;

    const vfsB = new VirtualFileSystem(vfsA.getSnapshot());
    vfsB.rename("vfs:///src/a.txt", "vfs:///dst/a.txt");

    const mutations = diffVfs(vfsA.getSnapshot(), vfsB.getSnapshot());
    const hasMove = mutations.some((m) => String(m.type).startsWith("TREE_MOVE"));
    expect(hasMove).toBe(true);

    const hasAddOrDeleteForMoved = mutations.some((m) => {
      if (m.type !== "TREE_ADD" && m.type !== "TREE_DELETE") {
        return false;
      }
      return m.targetUniqueName === movedId;
    });
    expect(hasAddOrDeleteForMoved).toBe(false);
  });
});
