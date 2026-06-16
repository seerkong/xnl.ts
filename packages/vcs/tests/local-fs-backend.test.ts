import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VcsError } from "../src/errors";
import { LocalFsRepositoryBackend } from "../src/local-fs-backend";
import { MemoryObjectStore } from "../src/object-store";
import { Repository } from "../src/repository";
import type { BlobObject } from "../src/types";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xnl-vcs-local-fs-"));
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("local-fs backend", () => {
  it("uses the same object IDs as memory store for identical objects", () => {
    const dir = makeTempDir();
    try {
      const backend = new LocalFsRepositoryBackend({ workspaceRootPath: dir });
      const memory = new MemoryObjectStore();

      const blob: BlobObject = {
        type: "blob",
        fileType: "text",
        contentRef: "abc123",
        contentType: "text",
        contentHash: "abc123",
        size: 5,
      };
      const idMemory = memory.put(blob);
      const idFs = backend.objectStore.put(blob);
      expect(idFs).toBe(idMemory);
    } finally {
      cleanupTempDir(dir);
    }
  });

  it("persists objects, HEAD, refs, and reflog on commit", () => {
    const dir = makeTempDir();
    try {
      const backend = new LocalFsRepositoryBackend({ workspaceRootPath: dir });
      const repo = new Repository({ backend });
      repo.init("main");

      repo.vfs.mkdir("vfs:///src", { recursive: true });
      repo.vfs.writeFile("vfs:///src/a.txt", "A", { fileType: "text" });
      const commitId = repo.commit("initial", { author: "tester" });

      expect(backend.objectStore.has(commitId)).toBe(true);
      expect(backend.readHead()).toEqual({ type: "branch", name: "main" });
      expect(backend.readRef("refs/heads/main")).toBe(commitId);

      const headLog = fs.readFileSync(path.join(dir, ".xnl-vcs", "logs", "HEAD.xnl"), "utf8");
      expect(headLog).toContain(commitId);
      const refLog = fs.readFileSync(path.join(dir, ".xnl-vcs", "logs", "refs", "heads", "main.xnl"), "utf8");
      expect(refLog).toContain(commitId);
    } finally {
      cleanupTempDir(dir);
    }
  });

  it("rejects ref updates when lock exists", () => {
    const dir = makeTempDir();
    try {
      const backend = new LocalFsRepositoryBackend({ workspaceRootPath: dir });
      const repo = new Repository({ backend });
      repo.init("main");

      const lockPath = path.join(dir, ".xnl-vcs", "locks", "refs_heads_main.lock");
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, "locked", "utf8");

      repo.vfs.mkdir("vfs:///src", { recursive: true });
      repo.vfs.writeFile("vfs:///src/a.txt", "A", { fileType: "text" });
      expect(() => repo.commit("blocked", { author: "tester" })).toThrowError(VcsError);
      try {
        repo.commit("blocked", { author: "tester" });
      } catch (err) {
        expect((err as VcsError).code).toBe("ELOCKED");
      }
    } finally {
      cleanupTempDir(dir);
    }
  });

  it("reports broken refs during recovery", () => {
    const dir = makeTempDir();
    try {
      const backend = new LocalFsRepositoryBackend({ workspaceRootPath: dir });
      backend.init("main");
      backend.writeRef("refs/heads/main", "missing");
      backend.writeHead({ type: "branch", name: "main" });

      const report = backend.checkIntegrity();
      expect(report.brokenRefs).toContain("refs/heads/main");
    } finally {
      cleanupTempDir(dir);
    }
  });

  it("writes HEAD/refs/logs/objects under external vcs storage root", () => {
    const workspaceDir = makeTempDir();
    const storageRootDir = makeTempDir();
    try {
      const backend = new LocalFsRepositoryBackend({
        workspaceRootPath: workspaceDir,
        vcsStorageRootPath: storageRootDir,
      });
      const repo = new Repository({ backend });
      repo.init("main");

      repo.vfs.mkdir("vfs:///src", { recursive: true });
      repo.vfs.writeFile("vfs:///src/a.txt", "A", { fileType: "text" });
      const commitId = repo.commit("initial", { author: "tester" });

      const externalVcsDir = path.join(storageRootDir, ".xnl-vcs");
      expect(fs.existsSync(path.join(externalVcsDir, "HEAD.xnl"))).toBe(true);
      expect(fs.existsSync(path.join(externalVcsDir, "refs", "heads", "main.xnl"))).toBe(true);
      expect(fs.existsSync(path.join(externalVcsDir, "logs", "HEAD.xnl"))).toBe(true);
      expect(fs.existsSync(path.join(externalVcsDir, "logs", "refs", "heads", "main.xnl"))).toBe(true);
      expect(backend.objectStore.has(commitId)).toBe(true);

      expect(fs.existsSync(path.join(workspaceDir, ".xnl-vcs"))).toBe(false);
    } finally {
      cleanupTempDir(workspaceDir);
      cleanupTempDir(storageRootDir);
    }
  });
});
