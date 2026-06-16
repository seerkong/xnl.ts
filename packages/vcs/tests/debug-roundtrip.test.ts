import { describe, expect, it } from "vitest";
import { Repository } from "../src";
import { VirtualFileSystem } from "xnl-vfs";

describe("commit round-trip: status should be clean immediately after commit", () => {
  it("simple file - status clean after commit", () => {
    const vfs = new VirtualFileSystem();
    const repo = new Repository({ vfs });
    repo.init("main");

    vfs.writeFile("vfs:///hello.txt", "hello world", { fileType: "text" });
    repo.commit("initial");

    const status = repo.status();
    expect(status.clean).toBe(true);
    expect(status.entries).toEqual([]);
  });

  it("file with UI metadata - status clean after commit", () => {
    const vfs = new VirtualFileSystem();
    const repo = new Repository({ vfs });
    repo.init("main");

    vfs.writeFile("vfs:///hello.txt", "hello world", { fileType: "text" });

    // Simulate adapter attaching UI metadata (like the demo app does)
    const snapshot = vfs.getSnapshot();
    const child = (snapshot as any).body[0];
    if (child) {
      child.metadata.uiSortOrder = 0;
      child.metadata.uiCached = false;
      child.metadata.uiCreatedAt = "2025-01-01T00:00:00.000Z";
      child.metadata.uiUpdatedAt = "2025-01-01T00:00:00.000Z";
      child.metadata.uiSourceType = "static";
      child.metadata.uiSourceConfigJson = JSON.stringify({ content: "hello world", contentType: "text" });
    }
    vfs.loadSnapshot(snapshot);

    repo.commit("initial");

    const status = repo.status();
    expect(status.clean).toBe(true);
    expect(status.entries).toEqual([]);
  });

  it("multiple files with UI metadata - status clean after commit", () => {
    const vfs = new VirtualFileSystem();
    const repo = new Repository({ vfs });
    repo.init("main");

    vfs.writeFile("vfs:///a.txt", "aaa", { fileType: "text" });
    vfs.writeFile("vfs:///b.txt", "bbb", { fileType: "text" });
    vfs.mkdir("vfs:///sub");
    vfs.writeFile("vfs:///sub/c.txt", "ccc", { fileType: "text" });

    // Attach UI metadata to all nodes
    const snapshot = vfs.getSnapshot();
    const attachMeta = (node: any) => {
      node.metadata.uiSortOrder = 0;
      node.metadata.uiCached = false;
      node.metadata.uiCreatedAt = "2025-01-01T00:00:00.000Z";
      node.metadata.uiUpdatedAt = "2025-01-01T00:00:00.000Z";
      if (node.tag === "file") {
        node.metadata.uiSourceType = "static";
        node.metadata.uiSourceConfigJson = JSON.stringify({ content: "test", contentType: "text" });
      }
      if (node.body) {
        for (const child of node.body) {
          if (child && typeof child === "object" && child.kind === "DataElement") {
            attachMeta(child);
          }
        }
      }
    };
    attachMeta(snapshot);
    vfs.loadSnapshot(snapshot);

    repo.commit("initial");

    const status = repo.status();
    expect(status.clean).toBe(true);
    expect(status.entries).toEqual([]);
  });

  it("root folder metadata round-trip", () => {
    const vfs = new VirtualFileSystem();
    const repo = new Repository({ vfs });
    repo.init("main");

    // Attach UI metadata to root folder
    const snapshot = vfs.getSnapshot();
    snapshot.metadata.uiSortOrder = 0;
    snapshot.metadata.uiCached = false;
    vfs.loadSnapshot(snapshot);

    repo.commit("initial");

    const status = repo.status();
    expect(status.clean).toBe(true);
    expect(status.entries).toEqual([]);
  });
});
