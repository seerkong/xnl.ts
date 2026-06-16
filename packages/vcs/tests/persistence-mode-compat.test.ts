import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VirtualFileSystem } from "xnl-vfs";
import { LocalFsVfsPersistence } from "xnl-vfs/local-fs-persistence";
import { LocalFsRepositoryBackend } from "../src/local-fs-backend";
import { Repository } from "../src/repository";
import {
  captureRepositorySnapshot,
  deserializeRepositorySnapshotFromString,
  restoreRepositoryFromSnapshot,
  serializeRepositorySnapshotToString,
} from "../src/xnl-snapshot";

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xnl-persistence-compat-"));
}

function rmTmpDir(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

describe("persistence compatibility", () => {
  it("supports local-fs -> snapshot export/import without semantic loss", () => {
    const workspace = mkTmpDir();
    try {
      const vfsPersistence = new LocalFsVfsPersistence({ workspaceRootPath: workspace });
      const vfs = new VirtualFileSystem(undefined, {
        reservedNames: vfsPersistence.getReservedNames(),
      });

      const backend = new LocalFsRepositoryBackend({ workspaceRootPath: workspace });
      const repo = new Repository({ vfs, backend });
      repo.init("main");

      repo.vfs.mkdir("vfs:///src", { recursive: true });
      repo.vfs.writeFile("vfs:///src/main.ts", "export const v = 1;", {
        fileType: "text",
        metadataId: "f_main",
        extend: {
          order: ["ViewExt"],
          children: {
            ViewExt: { kind: "DataElement", tag: "ViewExt", metadata: { color: "green" } },
          },
        },
      });
      const base = repo.commit("base", { author: "tester" });

      repo.createBranch("feature");
      repo.checkout("feature");
      repo.vfs.writeFile("vfs:///src/main.ts", "export const v = 2;", { overwrite: true, fileType: "text" });
      const feature = repo.commit("feature", { author: "tester" });
      repo.createTag("v1.0.0", feature, "release");

      expect(repo.status().clean).toBe(true);
      expect(repo.getHead()).toEqual({ type: "branch", name: "feature" });

      const snapshot = captureRepositorySnapshot(repo);
      const text = serializeRepositorySnapshotToString(snapshot, { mode: "full" });
      const restoredSnapshot = deserializeRepositorySnapshotFromString(text);
      expect(restoredSnapshot).toEqual(snapshot);

      const restored = restoreRepositoryFromSnapshot(restoredSnapshot);
      expect(restored.status().clean).toBe(true);
      expect(restored.getHead()).toEqual({ type: "branch", name: "feature" });
      expect(restored.getBranchHead("main")).toBe(base);
      expect(restored.getBranchHead("feature")).toBe(feature);
      expect(restored.vfs.readFile("vfs:///src/main.ts")).toBe("export const v = 2;");
      expect(captureRepositorySnapshot(restored)).toEqual(snapshot);
    } finally {
      rmTmpDir(workspace);
    }
  });
});
