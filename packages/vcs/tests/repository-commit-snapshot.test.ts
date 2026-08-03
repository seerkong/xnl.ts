import type { DataElementNode } from "xnl-core";
import { VirtualFileSystem } from "xnl-vfs";
import { describe, expect, it } from "vitest";
import { MemoryContentStore, type ContentRecord, type ContentStore } from "../src/content-store";
import type { ObjectId } from "../src/hash";
import { MemoryObjectStore, type ObjectStore } from "../src/object-store";
import type { RepositoryBackend, WorkspaceState } from "../src/repository-backend";
import { Repository } from "../src/repository";
import { readLosslessTreeSnapshot } from "../src/tree-converter";
import type { CommitObject, ContentKey, ContentType, TreeObject, VcsObject } from "../src/types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function snapshotWithFile(content: string, path = "vfs:///src/main.ts"): DataElementNode {
  const vfs = new VirtualFileSystem();
  vfs.mkdir("vfs:///src", { recursive: true });
  vfs.writeFile(path, content, { fileType: "text" });
  return vfs.getSnapshot();
}

class MemoryRepositoryBackend implements RepositoryBackend {
  readonly objectStore = new MemoryObjectStore();
  readonly contentStore = new MemoryContentStore();
  private readonly refs = new Map<string, ObjectId | null>();
  private workspace: WorkspaceState | null = null;

  init(defaultBranch: string): void {
    this.refs.clear();
    this.refs.set(defaultBranch, null);
    this.workspace = null;
  }

  writeHead(): void {}

  readHead(): null {
    return null;
  }

  readRef(refName: string): ObjectId | null {
    return this.refs.get(refName) ?? null;
  }

  writeRef(refName: string, target: ObjectId | null): void {
    this.refs.set(refName, target);
  }

  appendReflog(): void {}

  updateBranchHead(info: { branchName: string; newCommitId: ObjectId }): void {
    this.refs.set(info.branchName, info.newCommitId);
  }

  writeWorkspaceState(state: WorkspaceState): void {
    this.workspace = clone(state);
  }

  readWorkspaceState(): WorkspaceState | null {
    return this.workspace ? clone(this.workspace) : null;
  }

  checkIntegrity(): { brokenRefs: string[]; warnings: string[] } {
    return { brokenRefs: [], warnings: [] };
  }
}

class FaultInjectingRepositoryBackend extends MemoryRepositoryBackend {
  readWorkspaceError: Error | null = null;
  writeWorkspaceError: Error | null = null;
  updateBranchError: Error | null = null;

  override updateBranchHead(info: { branchName: string; newCommitId: ObjectId }): void {
    if (this.updateBranchError) {
      const error = this.updateBranchError;
      this.updateBranchError = null;
      throw error;
    }
    super.updateBranchHead(info);
  }

  override writeWorkspaceState(state: WorkspaceState): void {
    if (this.writeWorkspaceError) {
      const error = this.writeWorkspaceError;
      this.writeWorkspaceError = null;
      throw error;
    }
    super.writeWorkspaceState(state);
  }

  override readWorkspaceState(): WorkspaceState | null {
    if (this.readWorkspaceError) {
      const error = this.readWorkspaceError;
      this.readWorkspaceError = null;
      throw error;
    }
    return super.readWorkspaceState();
  }
}

class FaultInjectingVfs extends VirtualFileSystem {
  getSnapshotError: Error | null = null;
  private loadsBeforeFailure: number | null = null;
  private loadError: Error | null = null;

  failLoadAfter(successfulLoads: number, error: Error): void {
    this.loadsBeforeFailure = successfulLoads;
    this.loadError = error;
  }

  override getSnapshot(): DataElementNode {
    if (this.getSnapshotError) {
      const error = this.getSnapshotError;
      this.getSnapshotError = null;
      throw error;
    }
    return super.getSnapshot();
  }

  override loadSnapshot(snapshot: DataElementNode): void {
    if (this.loadsBeforeFailure === 0) {
      const error = this.loadError ?? new Error("Injected VFS load failure");
      this.loadsBeforeFailure = null;
      this.loadError = null;
      throw error;
    }
    if (this.loadsBeforeFailure !== null) {
      this.loadsBeforeFailure -= 1;
    }
    super.loadSnapshot(snapshot);
  }
}

class FaultInjectingObjectStore implements ObjectStore {
  readonly inner = new MemoryObjectStore();
  commitPutError: Error | null = null;

  put(object: VcsObject): ObjectId {
    if (object.type === "commit" && this.commitPutError) {
      const error = this.commitPutError;
      this.commitPutError = null;
      throw error;
    }
    return this.inner.put(object);
  }

  get<T extends VcsObject = VcsObject>(id: ObjectId): T | null {
    return this.inner.get<T>(id);
  }

  has(id: ObjectId): boolean {
    return this.inner.has(id);
  }

  list(): ObjectId[] {
    return this.inner.list();
  }
}

class FaultInjectingContentStore extends MemoryContentStore {
  putError: Error | null = null;

  override put(content: string, contentType: ContentType): ContentKey {
    if (this.putError) {
      const error = this.putError;
      this.putError = null;
      throw error;
    }
    return super.put(content, contentType);
  }
}

class SpyContentStore implements ContentStore {
  readonly inner = new MemoryContentStore();
  putCalls: { content: string; contentType: ContentType }[] = [];

  put(content: string, contentType: ContentType): ContentKey {
    this.putCalls.push({ content, contentType });
    return this.inner.put(content, contentType);
  }

  get(key: ContentKey): string | null {
    return this.inner.get(key);
  }

  getRecord(key: ContentKey): ContentRecord | null {
    return this.inner.getRecord(key);
  }

  has(key: ContentKey): boolean {
    return this.inner.has(key);
  }
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function getCommit(repository: Repository, commitId: ObjectId): CommitObject {
  const object = repository.store.get<CommitObject>(commitId);
  if (!object || object.type !== "commit") {
    throw new Error(`Expected commit object ${commitId}`);
  }
  return object;
}

describe("Repository.commitSnapshot", () => {
  it("commits the supplied exact snapshot through a v2 tree and restores public worktree state", () => {
    const backend = new MemoryRepositoryBackend();
    const repository = new Repository({ backend });
    repository.init();

    repository.vfs.mkdir("vfs:///scratch", { recursive: true });
    repository.vfs.writeFile("vfs:///scratch/public.txt", "public only", {
      fileType: "text",
    });
    const publicWorktreeBefore = repository.vfs.getSnapshot();
    const backendWorkspaceBefore = backend.readWorkspaceState();
    const authoritySnapshot = snapshotWithFile("authority only");

    const result = repository.commitSnapshot(authoritySnapshot, "authority checkpoint", {
      author: "p4-test",
    });

    expect(result).toMatchObject({
      status: "committed",
      headBefore: null,
      observedHead: expect.stringMatching(/^[a-f0-9]{64}$/),
      historyState: "accepted",
      worktreeState: "restored",
    });
    if (result.status !== "committed") return;
    expect(result.commitId).toBe(result.observedHead);
    expect(repository.getHeadCommitId()).toBe(result.commitId);
    expect(repository.vfs.getSnapshot()).toEqual(publicWorktreeBefore);
    expect(backend.readWorkspaceState()).toEqual(backendWorkspaceBefore);

    const commit = getCommit(repository, result.commitId);
    const tree = repository.store.get<TreeObject>(commit.tree);
    expect(tree?.type).toBe("tree");
    expect(tree?.xnlVfsFormat).toBe("xnl-vfs-v2");
    expect(readLosslessTreeSnapshot(commit.tree, repository.store, repository.contentStore)).toEqual(
      authoritySnapshot,
    );
  });

  it("returns a restored pre-commit failure with observed head evidence", () => {
    const repository = new Repository();
    repository.init();
    repository.vfs.writeFile("vfs:///base.txt", "base", { fileType: "text" });
    const baseCommit = repository.commit("base", { author: "p4-test" });
    repository.checkout(baseCommit, { force: true });
    repository.vfs.writeFile("vfs:///detached-public.txt", "public", {
      fileType: "text",
    });
    const publicWorktreeBefore = repository.vfs.getSnapshot();

    const result = repository.commitSnapshot(
      snapshotWithFile("detached authority"),
      "detached checkpoint",
    );

    expect(result).toMatchObject({
      status: "failed",
      phase: "pre-commit",
      headBefore: baseCommit,
      observedHead: baseCommit,
      historyState: "not-started",
      worktreeState: "restored",
    });
    expect(repository.getHeadCommitId()).toBe(baseCommit);
    expect(repository.vfs.getSnapshot()).toEqual(publicWorktreeBefore);
    if (result.status !== "failed") return;
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "EDETACHEDHEAD",
        message: "Cannot commit while HEAD is detached",
      }),
    ]);
  });
});

describe("Repository.commitSnapshot failure boundaries", () => {
  it("closes a public worktree capture failure with a truthfully observed unborn head", () => {
    const vfs = new FaultInjectingVfs();
    const repository = new Repository({ vfs });
    repository.init();
    const publicWorktreeBefore = vfs.getSnapshot();
    const authoritySnapshot = snapshotWithFile("authority");
    vfs.getSnapshotError = codedError("ECAPTURE", "public worktree capture failed");

    const result = repository.commitSnapshot(authoritySnapshot, "capture failure");

    expect(result).toMatchObject({
      status: "failed",
      phase: "stage",
      headBefore: null,
      observedHead: null,
      historyState: "not-started",
      worktreeState: "restored",
      diagnostics: [
        expect.objectContaining({
          code: "ECAPTURE",
          message: "public worktree capture failed",
        }),
      ],
    });
    expect(repository.getHeadCommitId()).toBeNull();
    expect(vfs.getSnapshot()).toEqual(publicWorktreeBefore);
  });

  it("closes backend workspace capture failure without advancing history or worktree", () => {
    const backend = new FaultInjectingRepositoryBackend();
    const repository = new Repository({ backend });
    repository.init();
    repository.vfs.writeFile("vfs:///public.txt", "public", { fileType: "text" });
    const publicWorktreeBefore = repository.vfs.getSnapshot();
    const backendWorkspaceBefore = backend.readWorkspaceState();
    backend.readWorkspaceError = codedError("EWORKSPACEREAD", "workspace capture failed");

    const result = repository.commitSnapshot(
      snapshotWithFile("authority"),
      "workspace capture failure",
    );

    expect(result).toMatchObject({
      status: "failed",
      phase: "stage",
      headBefore: null,
      observedHead: null,
      historyState: "not-started",
      worktreeState: "restored",
      diagnostics: [
        expect.objectContaining({
          code: "EWORKSPACEREAD",
          message: "workspace capture failed",
        }),
      ],
    });
    expect(repository.vfs.getSnapshot()).toEqual(publicWorktreeBefore);
    expect(backend.readWorkspaceState()).toEqual(backendWorkspaceBefore);
    expect(repository.getHeadCommitId()).toBeNull();
  });

  it("returns a restored stage failure when staging the authority snapshot fails", () => {
    const vfs = new FaultInjectingVfs();
    const repository = new Repository({ vfs });
    repository.init();
    vfs.writeFile("vfs:///public.txt", "public", { fileType: "text" });
    const publicWorktreeBefore = vfs.getSnapshot();
    vfs.failLoadAfter(0, codedError("ESTAGELOAD", "staging load failed"));

    const result = repository.commitSnapshot(
      snapshotWithFile("authority"),
      "stage load failure",
    );

    expect(result).toMatchObject({
      status: "failed",
      phase: "stage",
      headBefore: null,
      observedHead: null,
      historyState: "not-started",
      worktreeState: "restored",
      diagnostics: [
        expect.objectContaining({
          code: "ESTAGELOAD",
          message: "staging load failed",
        }),
      ],
    });
    expect(vfs.getSnapshot()).toEqual(publicWorktreeBefore);
  });

  it("returns a restored stage failure when lossless tree construction fails", () => {
    const contentStore = new FaultInjectingContentStore();
    const repository = new Repository({ contentStore });
    repository.init();
    repository.vfs.writeFile("vfs:///public.txt", "public", { fileType: "text" });
    const publicWorktreeBefore = repository.vfs.getSnapshot();
    contentStore.putError = codedError("ECONTENTPUT", "content staging failed");

    const result = repository.commitSnapshot(
      snapshotWithFile("authority"),
      "tree build failure",
    );

    expect(result).toMatchObject({
      status: "failed",
      phase: "stage",
      headBefore: null,
      observedHead: null,
      historyState: "not-started",
      worktreeState: "restored",
      diagnostics: [
        expect.objectContaining({
          code: "ECONTENTPUT",
          message: "content staging failed",
        }),
      ],
    });
    expect(repository.vfs.getSnapshot()).toEqual(publicWorktreeBefore);
    expect(repository.getHeadCommitId()).toBeNull();
  });

  it("classifies commit-object storage failure as pre-commit when HEAD provably did not advance", () => {
    const store = new FaultInjectingObjectStore();
    const repository = new Repository({ store });
    repository.init();
    repository.vfs.writeFile("vfs:///public.txt", "public", { fileType: "text" });
    const publicWorktreeBefore = repository.vfs.getSnapshot();
    store.commitPutError = codedError("ECOMMITPUT", "commit object write failed");

    const result = repository.commitSnapshot(
      snapshotWithFile("authority"),
      "commit object failure",
    );

    expect(result).toMatchObject({
      status: "failed",
      phase: "pre-commit",
      headBefore: null,
      observedHead: null,
      historyState: "not-started",
      worktreeState: "restored",
      diagnostics: [
        expect.objectContaining({
          code: "ECOMMITPUT",
          message: "commit object write failed",
        }),
      ],
    });
    expect(repository.getHeadCommitId()).toBeNull();
    expect(repository.vfs.getSnapshot()).toEqual(publicWorktreeBefore);
  });

  it("never reports not-started when backend failure follows in-memory history acceptance", () => {
    const backend = new FaultInjectingRepositoryBackend();
    const repository = new Repository({ backend });
    repository.init();
    const publicWorktreeBefore = repository.vfs.getSnapshot();
    const backendWorkspaceBefore = backend.readWorkspaceState();
    backend.updateBranchError = codedError("EBACKENDREF", "backend ref update failed");

    const result = repository.commitSnapshot(
      snapshotWithFile("authority"),
      "backend acceptance boundary",
    );

    expect(result).toMatchObject({
      status: "indeterminate",
      phase: "commit",
      headBefore: null,
      observedHead: expect.stringMatching(/^[a-f0-9]{64}$/),
      candidateCommitId: expect.stringMatching(/^[a-f0-9]{64}$/),
      historyState: "accepted",
      worktreeState: "restored",
      diagnostics: [
        expect.objectContaining({
          code: "EBACKENDREF",
          message: "backend ref update failed",
        }),
      ],
    });
    if (result.status !== "indeterminate") return;
    expect(result.observedHead).toBe(result.candidateCommitId);
    expect(repository.getHeadCommitId()).toBe(result.candidateCommitId);
    expect(repository.vfs.getSnapshot()).toEqual(publicWorktreeBefore);
    expect(backend.readWorkspaceState()).toEqual(backendWorkspaceBefore);
  });

  it("returns restore indeterminate when public worktree restoration fails after acceptance", () => {
    const vfs = new FaultInjectingVfs();
    const repository = new Repository({ vfs });
    repository.init();
    vfs.writeFile("vfs:///public.txt", "public", { fileType: "text" });
    vfs.failLoadAfter(1, codedError("EWORKTREERESTORE", "public restore failed"));

    const result = repository.commitSnapshot(
      snapshotWithFile("authority"),
      "public restore failure",
    );

    expect(result).toMatchObject({
      status: "indeterminate",
      phase: "restore",
      headBefore: null,
      observedHead: expect.stringMatching(/^[a-f0-9]{64}$/),
      candidateCommitId: expect.stringMatching(/^[a-f0-9]{64}$/),
      historyState: "accepted",
      worktreeState: "unknown",
      diagnostics: [
        expect.objectContaining({
          code: "EWORKTREERESTORE",
          message: "public restore failed",
        }),
      ],
    });
    if (result.status !== "indeterminate") return;
    expect(result.observedHead).toBe(result.candidateCommitId);
  });

  it("returns restore indeterminate when backend workspace restoration fails after acceptance", () => {
    const backend = new FaultInjectingRepositoryBackend();
    const repository = new Repository({ backend });
    repository.init();
    backend.writeWorkspaceError = codedError(
      "EWORKSPACEWRITE",
      "backend workspace restore failed",
    );

    const result = repository.commitSnapshot(
      snapshotWithFile("authority"),
      "backend restore failure",
    );

    expect(result).toMatchObject({
      status: "indeterminate",
      phase: "restore",
      headBefore: null,
      observedHead: expect.stringMatching(/^[a-f0-9]{64}$/),
      candidateCommitId: expect.stringMatching(/^[a-f0-9]{64}$/),
      historyState: "accepted",
      worktreeState: "unknown",
      diagnostics: [
        expect.objectContaining({
          code: "EWORKSPACEWRITE",
          message: "backend workspace restore failed",
        }),
      ],
    });
  });

  it("preserves a pre-commit diagnostic when workspace restoration also fails", () => {
    const backend = new FaultInjectingRepositoryBackend();
    const repository = new Repository({ backend });
    repository.init();
    repository.vfs.writeFile("vfs:///base.txt", "base", { fileType: "text" });
    const baseCommit = repository.commit("base");
    repository.checkout(baseCommit, { force: true });
    backend.writeWorkspaceError = codedError(
      "EWORKSPACEWRITE",
      "backend workspace restore failed",
    );

    const result = repository.commitSnapshot(
      snapshotWithFile("authority"),
      "pre-commit and restore failure",
    );

    expect(result).toMatchObject({
      status: "indeterminate",
      phase: "restore",
      headBefore: baseCommit,
      observedHead: baseCommit,
      historyState: "not-started",
      worktreeState: "unknown",
    });
    if (result.status !== "indeterminate") return;
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "EDETACHEDHEAD",
        message: "Cannot commit while HEAD is detached",
      }),
      expect.objectContaining({
        code: "EWORKSPACEWRITE",
        message: "backend workspace restore failed",
      }),
    ]);
  });
});

describe("legacy Repository.commit compatibility", () => {
  it("rejects detached HEAD before building a tree or writing content", () => {
    const contentStore = new SpyContentStore();
    const repository = new Repository({ contentStore });
    repository.init();
    repository.vfs.mkdir("vfs:///src", { recursive: true });
    repository.vfs.writeFile("vfs:///src/main.ts", "base", { fileType: "text" });
    const baseCommit = repository.commit("base", { author: "legacy-test" });
    repository.checkout(baseCommit, { force: true });

    repository.vfs.writeFile("vfs:///src/new.ts", "dirty detached content", {
      fileType: "text",
    });
    const objectIdsBefore = repository.store.list();
    const contentPutCallsBefore = contentStore.putCalls.length;

    expect(() => repository.commit("detached dirty", { author: "legacy-test" })).toThrowError(
      expect.objectContaining({
        code: "EDETACHEDHEAD",
        message: "Cannot commit while HEAD is detached",
      }),
    );

    expect(repository.store.list()).toEqual(objectIdsBefore);
    expect(contentStore.putCalls).toHaveLength(contentPutCallsBefore);
  });

  it("keeps branch legacy commit signature and builds one tree", () => {
    const contentStore = new SpyContentStore();
    const repository = new Repository({ contentStore });
    repository.init();
    repository.vfs.mkdir("vfs:///src", { recursive: true });
    repository.vfs.writeFile("vfs:///src/main.ts", "branch content", {
      fileType: "text",
    });

    const commitId = repository.commit("branch commit", { author: "legacy-test" });

    expect(commitId).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.getHeadCommitId()).toBe(commitId);
    expect(contentStore.putCalls).toEqual([
      { content: "branch content", contentType: "text" },
    ]);
    expect(getCommit(repository, commitId)).toMatchObject({
      author: "legacy-test",
      message: "branch commit",
      parents: [],
      type: "commit",
    });
  });
});
