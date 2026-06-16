import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalFsRepositoryBackend } from "../src/local-fs-backend";
import { Repository } from "../src/repository";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xnl-vcs-workspace-"));
}

describe("workspace state persistence", () => {
  it("persists the worktree on commit and restores it via loadWorkspaceState", () => {
    const dir = makeTempDir();
    try {
      const backend = new LocalFsRepositoryBackend({ workspaceRootPath: dir });
      const repo = new Repository({ backend });
      repo.init("main");

      repo.vfs.mkdir("vfs:///src", { recursive: true });
      repo.vfs.writeFile("vfs:///src/a.txt", "hello", { fileType: "text" });
      repo.commit("initial", { author: "tester" });

      // workspace.xnl persisted with the committed worktree
      expect(fs.existsSync(path.join(dir, ".xnl-vcs", "workspace.xnl"))).toBe(true);
      const state = backend.readWorkspaceState();
      expect(state).not.toBeNull();
      expect(state?.worktreeJson).toContain("a.txt");
      expect(state?.stagedJson).toBe(state?.worktreeJson);

      // a fresh repo on the same backend can restore the worktree without checkout
      const reopened = new Repository({ backend: new LocalFsRepositoryBackend({ workspaceRootPath: dir }) });
      const restored = reopened.loadWorkspaceState();
      expect(restored).toBe(true);
      expect(reopened.vfs.readFile("vfs:///src/a.txt")).toBe("hello");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when no workspace state is present", () => {
    const dir = makeTempDir();
    try {
      const repo = new Repository({ backend: new LocalFsRepositoryBackend({ workspaceRootPath: dir }) });
      expect(repo.loadWorkspaceState()).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
