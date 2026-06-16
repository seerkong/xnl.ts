import { describe, expect, it } from "vitest";
import { Repository, WORKTREE_REF } from "../src";
import { VirtualFileSystem } from "xnl-vfs";

describe("status after init + external VFS edit", () => {
  it("detects file added after init (no commit)", () => {
    const vfs = new VirtualFileSystem();
    const repo = new Repository({ vfs });
    repo.init("main");

    // Simulate: user creates a file in the tree editor
    vfs.writeFile("vfs:///hello.txt", "hello world", { fileType: "text" });

    const status = repo.status();
    expect(status.clean).toBe(false);
    expect(status.added.length).toBeGreaterThan(0);
  });

  it("detects file modified after commit", () => {
    const vfs = new VirtualFileSystem();
    const repo = new Repository({ vfs });
    repo.init("main");

    vfs.writeFile("vfs:///hello.txt", "hello world", { fileType: "text" });
    repo.commit("initial");

    // Simulate: user edits the file in the tree editor
    vfs.writeFile("vfs:///hello.txt", "hello world v2", { fileType: "text", overwrite: true });

    const status = repo.status();
    expect(status.clean).toBe(false);
    expect(status.modified).toContain("vfs:///hello.txt");
  });

  it("detects changes after loadSnapshot (simulating adapter save)", () => {
    const vfs = new VirtualFileSystem();
    const repo = new Repository({ vfs });
    repo.init("main");

    vfs.writeFile("vfs:///hello.txt", "hello world", { fileType: "text" });
    repo.commit("initial");

    // Simulate what adapterUpdateNode does:
    // 1. writeFile with new content
    vfs.writeFile("vfs:///hello.txt", "modified content", { fileType: "text", overwrite: true });
    // 2. getSnapshot + modify metadata + loadSnapshot
    const snapshot = vfs.getSnapshot();
    // Simulate attaching UI metadata
    const child = (snapshot as any).body[0];
    if (child) {
      child.metadata.uiSortOrder = 99;
    }
    vfs.loadSnapshot(snapshot);

    const status = repo.status();
    expect(status.clean).toBe(false);
    expect(status.modified.length).toBeGreaterThan(0);
  });
});
