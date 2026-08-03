import type { DataElementNode } from "xnl-core";
import {
  areXnlSnapshotsStructurallyEqual,
  VirtualFileSystem,
} from "xnl-vfs";
import { describe, expect, it, vi } from "vitest";
import { MemoryContentStore } from "../src/content-store";
import type { ObjectId } from "../src/hash";
import * as vcsModule from "../src/index";
import { MemoryObjectStore } from "../src/object-store";
import {
  Repository,
  type RepositoryCommitSnapshotOptions,
  type RepositoryCommitSnapshotResult,
} from "../src/repository";
import type {
  HeadState,
  PersistedCommitInfo,
  RepositoryBackend,
  WorkspaceState,
} from "../src/repository-backend";
import { readTreeSnapshot } from "../src/tree-converter";
import type { CommitObject, TreeObject, VcsObject } from "../src/types";

type Awaitable<T> = T | PromiseLike<T>;

interface VfsRevision {
  readonly authorityId: string;
  readonly value: string;
}

interface RevisionedVfsSnapshot {
  readonly revision: VfsRevision;
  readonly snapshot: DataElementNode;
}

interface RevisionedVfsAuthority {
  read(): Awaitable<RevisionedVfsSnapshot>;
  compareAndSwap(input: {
    readonly expectedRevision: VfsRevision;
    readonly snapshot: DataElementNode;
  }): Awaitable<unknown>;
}

interface RevisionedPersistenceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

interface RepositoryCheckpointReceipt {
  readonly liveRevision: VfsRevision;
  readonly commitId: ObjectId;
  readonly durability: "memory-accepted" | "backend-flushed";
}

type RepositoryCheckpointResult =
  | {
      readonly status: "checkpointed";
      readonly receipt: RepositoryCheckpointReceipt;
    }
  | {
      readonly status: "conflict";
      readonly expectedRevision: VfsRevision;
      readonly actualRevision: VfsRevision;
    }
  | {
      readonly status: "failed";
      readonly phase: "read" | "pre-commit";
      readonly historyState: "not-started";
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
      readonly headBefore: ObjectId | null;
      readonly observedHead: ObjectId | null;
      readonly worktreeState: "restored";
    }
  | {
      readonly status: "indeterminate";
      readonly phase: "commit" | "post-commit-verify" | "flush" | "restore";
      readonly liveRevision: VfsRevision;
      readonly headBefore: ObjectId | null;
      readonly observedHead: ObjectId | null;
      readonly candidateCommitId?: ObjectId;
      readonly historyState: "not-started" | "possibly-accepted" | "accepted";
      readonly worktreeState: "restored" | "unknown";
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
    };

interface RevisionedRepositoryAdapter {
  open(): Awaitable<RevisionedVfsSnapshot>;
  checkpoint(
    expectedLiveRevision: VfsRevision,
    message: string,
    options?: { readonly author?: string },
  ): Awaitable<RepositoryCheckpointResult>;
}

type RevisionedRepositoryAdapterConstructor = new (options: {
  readonly repository: Repository;
  readonly authority: RevisionedVfsAuthority;
}) => RevisionedRepositoryAdapter;

function revisionedRepositoryAdapter(): RevisionedRepositoryAdapterConstructor {
  const Adapter = Reflect.get(vcsModule, "RevisionedRepositoryAdapter");
  if (typeof Adapter !== "function") {
    throw new Error(
      "Expected xnl-vcs to export RevisionedRepositoryAdapter with explicit checkpoint support",
    );
  }
  return Adapter as unknown as RevisionedRepositoryAdapterConstructor;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function workspaceSnapshot(content = "export const value = 1;"): DataElementNode {
  const vfs = new VirtualFileSystem();
  vfs.mkdir("vfs:///src", { recursive: true });
  vfs.writeFile("vfs:///src/main.ts", content, { fileType: "text" });
  return vfs.getSnapshot();
}

function legacyRepresentableWorkspaceSnapshot(
  content = "export const value = 1;",
): DataElementNode {
  const vfs = new VirtualFileSystem();
  vfs.writeFile("vfs:///main.ts", content, { fileType: "text" });
  return vfs.getSnapshot();
}

function revision(
  value: string,
  authorityId = "authority-a",
): VfsRevision {
  return { authorityId, value };
}

function revisionedSnapshot(
  value = "revision:1",
  content?: string,
): RevisionedVfsSnapshot {
  return {
    revision: revision(value),
    snapshot: workspaceSnapshot(content),
  };
}

class StaticRevisionedAuthority implements RevisionedVfsAuthority {
  constructor(private readonly current: RevisionedVfsSnapshot) {}

  read(): RevisionedVfsSnapshot {
    return clone(this.current);
  }

  compareAndSwap(): never {
    throw new Error("checkpoint characterization must not write the authority");
  }
}

class ThrowingReadAuthority implements RevisionedVfsAuthority {
  read(): never {
    throw new Error("authority read unavailable");
  }

  compareAndSwap(): never {
    throw new Error("checkpoint must not write the authority");
  }
}

class MemoryRepositoryBackend implements RepositoryBackend {
  readonly objectStore = new MemoryObjectStore();
  readonly contentStore = new MemoryContentStore();
  protected readonly refs = new Map<string, ObjectId | null>();
  protected head: HeadState | null = null;
  protected workspace: WorkspaceState | null = null;

  init(defaultBranch: string): void {
    this.head = { type: "branch", name: defaultBranch };
    this.refs.set(defaultBranch, null);
  }

  writeHead(head: HeadState): void {
    this.head = clone(head);
  }

  readHead(): HeadState | null {
    return this.head ? clone(this.head) : null;
  }

  readRef(refName: string): ObjectId | null {
    return this.refs.get(refName) ?? null;
  }

  writeRef(refName: string, target: ObjectId | null): void {
    this.refs.set(refName, target);
  }

  appendReflog(): void {}

  updateBranchHead(info: PersistedCommitInfo): void {
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

class FlushingMemoryBackend extends MemoryRepositoryBackend {
  flushCalls = 0;

  async flush(): Promise<void> {
    this.flushCalls += 1;
  }
}

class ThrowingFlushBackend extends FlushingMemoryBackend {
  override async flush(): Promise<void> {
    this.flushCalls += 1;
    throw new Error("backend flush unavailable");
  }
}

class DeferredFlushBackend extends FlushingMemoryBackend {
  readonly flushStarted = deferred();
  readonly flushCompletion = deferred();

  override async flush(): Promise<void> {
    this.flushCalls += 1;
    this.flushStarted.resolve();
    await this.flushCompletion.promise;
  }
}

class ThrowAfterMemoryHeadBackend extends MemoryRepositoryBackend {
  override updateBranchHead(info: PersistedCommitInfo): never {
    super.updateBranchHead(info);
    throw new Error("backend rejected after in-memory branch acceptance");
  }
}

class ThrowOnCommittedObjectReadStore extends MemoryObjectStore {
  private commitId?: ObjectId;

  override put(object: VcsObject): ObjectId {
    const objectId = super.put(object);
    if (object.type === "commit") {
      this.commitId = objectId;
    }
    return objectId;
  }

  override get<T extends VcsObject = VcsObject>(id: ObjectId): T | null {
    if (id === this.commitId) {
      throw new Error("committed object read unavailable");
    }
    return super.get<T>(id);
  }
}

class IdentityMismatchingRepository extends Repository {
  override commitSnapshot(
    snapshot: DataElementNode,
    message: string,
    options: RepositoryCommitSnapshotOptions = {},
  ): RepositoryCommitSnapshotResult {
    const mismatched = clone(snapshot);
    mismatched.id = {
      kind: "Word",
      namespace: ["other-authority"],
      name: "replacement",
    };
    return super.commitSnapshot(mismatched, message, options);
  }
}

class LegacyCommittingRepository extends Repository {
  override commitSnapshot(
    snapshot: DataElementNode,
    message: string,
    options: RepositoryCommitSnapshotOptions = {},
  ): RepositoryCommitSnapshotResult {
    const headBefore = this.getHeadCommitId();
    const publicWorktree = this.vfs.getSnapshot();

    try {
      this.vfs.loadSnapshot(clone(snapshot));
      const commitId = this.commit(message, options);
      return {
        status: "committed",
        commitId,
        headBefore,
        observedHead: this.getHeadCommitId(),
        historyState: "accepted",
        worktreeState: "restored",
      };
    } finally {
      this.vfs.loadSnapshot(publicWorktree);
    }
  }
}

class OutcomeRepository extends Repository {
  constructor(private readonly outcome: RepositoryCommitSnapshotResult) {
    super();
    this.init();
  }

  override commitSnapshot(): RepositoryCommitSnapshotResult {
    return this.outcome;
  }
}

function createAdapter(
  repository: Repository,
  authority: RevisionedVfsAuthority,
): RevisionedRepositoryAdapter {
  const Adapter = revisionedRepositoryAdapter();
  return new Adapter({ repository, authority });
}

describe("revisioned repository checkpoint characterization", () => {
  it("keeps live revision and commit identity in a distinct checkpoint receipt", async () => {
    const repository = new Repository();
    repository.init();
    const current = revisionedSnapshot("revision:4");
    current.snapshot.id = {
      kind: "Word",
      namespace: ["authority"],
      name: "workspace",
    };
    const authority = new StaticRevisionedAuthority(current);
    const adapter = createAdapter(repository, authority);
    await adapter.open();

    expect(repository.getHeadCommitId()).toBeNull();
    const result = await adapter.checkpoint(current.revision, "checkpoint", {
      author: "characterization",
    });

    expect(result.status).toBe("checkpointed");
    if (result.status !== "checkpointed") return;
    expect(result.receipt).toEqual({
      liveRevision: current.revision,
      commitId: expect.stringMatching(/^[a-f0-9]{64}$/),
      durability: "memory-accepted",
    });
    expect(result.receipt.liveRevision).not.toEqual(result.receipt.commitId);
    expect(result.receipt).not.toHaveProperty("revision");
    expect(repository.getHeadCommitId()).toBe(result.receipt.commitId);
    expect((await authority.read()).revision).toEqual(current.revision);
  });

  it.each([
    {
      label: "stale",
      expected: revision("revision:1"),
    },
    {
      label: "cross-authority",
      expected: revision("revision:2", "authority-b"),
    },
  ])(
    "returns checkpoint conflict for a $label revision without creating history",
    async ({ expected }) => {
      const repository = new Repository();
      repository.init();
      const current = revisionedSnapshot("revision:2");
      const adapter = createAdapter(
        repository,
        new StaticRevisionedAuthority(current),
      );
      await adapter.open();

      const result = await adapter.checkpoint(expected, "conflicting checkpoint");

      expect(result).toEqual({
        status: "conflict",
        expectedRevision: expected,
        actualRevision: current.revision,
      });
      expect(repository.getHeadCommitId()).toBeNull();
      expect(repository.store.list()).toEqual([]);
    },
  );

  it("maps authority read failure to failed/read with explicit null head evidence", async () => {
    const repository = new Repository();
    repository.init();
    const adapter = createAdapter(repository, new ThrowingReadAuthority());

    const result = await adapter.checkpoint(
      revision("revision:1"),
      "unreadable checkpoint",
    );

    expect(result).toMatchObject({
      status: "failed",
      phase: "read",
      historyState: "not-started",
      headBefore: null,
      observedHead: null,
      worktreeState: "restored",
      diagnostics: [
        {
          code: "revisioned-repository-checkpoint-read-failed",
          message: "Unable to read the revisioned VFS authority for checkpoint",
        },
      ],
    });
    expect(result).toHaveProperty("headBefore");
    expect(result).toHaveProperty("observedHead");
    expect(repository.getHeadCommitId()).toBeNull();
  });

  it.each(["stage", "pre-commit"] as const)(
    "maps Repository %s failure to failed/pre-commit",
    async (repositoryPhase) => {
      const current = revisionedSnapshot("revision:3");
      const diagnostics = [
        {
          code: `repository-${repositoryPhase}-failed`,
          message: `${repositoryPhase} failed`,
        },
      ];
      const repository = new OutcomeRepository({
        status: "failed",
        phase: repositoryPhase,
        headBefore: null,
        observedHead: null,
        historyState: "not-started",
        worktreeState: "restored",
        diagnostics,
      });
      const adapter = createAdapter(
        repository,
        new StaticRevisionedAuthority(current),
      );

      const result = await adapter.checkpoint(
        current.revision,
        "pre-commit failure",
      );

      expect(result).toEqual({
        status: "failed",
        phase: "pre-commit",
        headBefore: null,
        observedHead: null,
        historyState: "not-started",
        worktreeState: "restored",
        diagnostics,
      });
    },
  );

  it.each([
    {
      phase: "commit" as const,
      outcome: {
        status: "indeterminate" as const,
        phase: "commit" as const,
        headBefore: null,
        observedHead: "a".repeat(64) as ObjectId,
        candidateCommitId: "a".repeat(64) as ObjectId,
        historyState: "possibly-accepted" as const,
        worktreeState: "restored" as const,
        diagnostics: [
          {
            code: "repository-commit-failed",
            message: "commit acceptance is uncertain",
          },
        ],
      },
    },
    {
      phase: "restore" as const,
      outcome: {
        status: "indeterminate" as const,
        phase: "restore" as const,
        headBefore: null,
        observedHead: null,
        historyState: "not-started" as const,
        worktreeState: "unknown" as const,
        diagnostics: [
          {
            code: "repository-restore-failed",
            message: "worktree restoration is uncertain",
          },
        ],
      },
    },
  ])(
    "preserves Repository $phase indeterminate evidence",
    async ({ outcome }) => {
      const current = revisionedSnapshot("revision:5");
      const repository = new OutcomeRepository(outcome);
      const adapter = createAdapter(
        repository,
        new StaticRevisionedAuthority(current),
      );

      const result = await adapter.checkpoint(
        current.revision,
        "indeterminate checkpoint",
      );

      expect(result).toEqual({
        ...outcome,
        liveRevision: current.revision,
      });
      expect(result).toHaveProperty("headBefore");
      expect(result).toHaveProperty("observedHead");
    },
  );

  it("reports indeterminate history when backend failure follows in-memory acceptance", async () => {
    const repository = new Repository({
      backend: new ThrowAfterMemoryHeadBackend(),
    });
    repository.init();
    const current: RevisionedVfsSnapshot = {
      revision: { authorityId: "authority-a", value: "revision:7" },
      snapshot: workspaceSnapshot("export const value = 7;"),
    };
    const adapter = createAdapter(
      repository,
      new StaticRevisionedAuthority(current),
    );
    await adapter.open();
    const worktreeBefore = repository.vfs.getSnapshot();

    const result = await adapter.checkpoint(
      current.revision,
      "backend failure checkpoint",
      { author: "characterization" },
    );

    expect(result.status).toBe("indeterminate");
    if (result.status !== "indeterminate") return;
    expect(result.phase).toBe("commit");
    expect(result.historyState).not.toBe("not-started");
    expect(result.headBefore).toBeNull();
    expect(result.observedHead).not.toBeNull();
    expect(result.observedHead).toBe(repository.getHeadCommitId());
    expect(result.worktreeState).toBe("restored");
    expect(repository.vfs.getSnapshot()).toEqual(worktreeBefore);
  });

  it("maps committed object read failure to indeterminate post-commit verification", async () => {
    const repository = new Repository({
      store: new ThrowOnCommittedObjectReadStore(),
    });
    repository.init();
    const current = revisionedSnapshot(
      "revision:8",
      "export const value = 8;",
    );
    const adapter = createAdapter(
      repository,
      new StaticRevisionedAuthority(current),
    );
    await adapter.open();

    const result = await adapter.checkpoint(
      current.revision,
      "verification read failure",
    );

    expect(result.status).toBe("indeterminate");
    if (result.status !== "indeterminate") return;
    expect(result).toMatchObject({
      phase: "post-commit-verify",
      liveRevision: current.revision,
      headBefore: null,
      observedHead: repository.getHeadCommitId(),
      candidateCommitId: repository.getHeadCommitId(),
      historyState: "accepted",
      worktreeState: "restored",
    });
    expect(result.diagnostics[0]?.code).toBe(
      "revisioned-repository-checkpoint-verify-read-failed",
    );
  });

  it("rejects a markerless legacy commit even when its projection is structurally equal", async () => {
    const repository = new LegacyCommittingRepository();
    repository.init();
    const current = {
      revision: revision("revision:legacy"),
      snapshot: legacyRepresentableWorkspaceSnapshot(
        "export const value = 'legacy';",
      ),
    };
    const adapter = createAdapter(
      repository,
      new StaticRevisionedAuthority(current),
    );
    await adapter.open();
    const worktreeBefore = repository.vfs.getSnapshot();

    const result = await adapter.checkpoint(
      current.revision,
      "markerless legacy checkpoint",
    );

    const candidateCommitId = repository.getHeadCommitId();
    expect(candidateCommitId).not.toBeNull();
    if (!candidateCommitId) return;
    const commit = repository.store.get<CommitObject>(candidateCommitId);
    expect(commit).toMatchObject({
      type: "commit",
      tree: expect.any(String),
    });
    if (!commit || commit.type !== "commit") return;
    const tree = repository.store.get<TreeObject>(commit.tree);
    expect(tree).toMatchObject({ type: "tree" });
    expect(tree).not.toHaveProperty("xnlVfsFormat");
    const legacyProjection = readTreeSnapshot(
      commit.tree,
      repository.store,
      repository.contentStore,
    );
    expect(
      areXnlSnapshotsStructurallyEqual(
        legacyProjection,
        current.snapshot,
      ),
    ).toBe(true);

    expect(result).toMatchObject({
      status: "indeterminate",
      phase: "post-commit-verify",
      liveRevision: current.revision,
      headBefore: null,
      observedHead: candidateCommitId,
      candidateCommitId,
      historyState: "accepted",
      worktreeState: "restored",
      diagnostics: [
        {
          code: "revisioned-repository-checkpoint-verify-read-failed",
          message: "Unable to read the committed checkpoint tree",
        },
      ],
    });
    expect(repository.getHeadCommitId()).toBe(candidateCommitId);
    expect(repository.vfs.getSnapshot()).toEqual(worktreeBefore);
  });

  it("rejects a committed tree that differs only by explicit #id", async () => {
    const repository = new IdentityMismatchingRepository();
    repository.init();
    const current = revisionedSnapshot("revision:9");
    current.snapshot.id = {
      kind: "Word",
      namespace: ["authority"],
      name: "workspace",
    };
    const adapter = createAdapter(
      repository,
      new StaticRevisionedAuthority(current),
    );
    await adapter.open();

    const result = await adapter.checkpoint(
      current.revision,
      "identity mismatch checkpoint",
    );

    expect(result.status).toBe("indeterminate");
    if (result.status !== "indeterminate") return;
    expect(result).toMatchObject({
      phase: "post-commit-verify",
      liveRevision: current.revision,
      headBefore: null,
      observedHead: repository.getHeadCommitId(),
      candidateCommitId: repository.getHeadCommitId(),
      historyState: "accepted",
      worktreeState: "restored",
      diagnostics: [
        {
          code: "revisioned-repository-checkpoint-verify-mismatch",
          message:
            "Committed checkpoint tree does not structurally equal the authority snapshot",
        },
      ],
    });
  });
});

describe("revisioned repository checkpoint durability", () => {
  it("reports backend-flushed only after the bound backend flush resolves", async () => {
    const backend = new FlushingMemoryBackend();
    const repository = new Repository({ backend });
    repository.init();
    const current = revisionedSnapshot("revision:10");
    const adapter = createAdapter(
      repository,
      new StaticRevisionedAuthority(current),
    );

    const result = await adapter.checkpoint(
      current.revision,
      "bound backend checkpoint",
    );

    expect(result.status).toBe("checkpointed");
    if (result.status !== "checkpointed") return;
    expect(result.receipt.durability).toBe("backend-flushed");
    expect(backend.flushCalls).toBe(1);
  });

  it("reports memory-accepted when the bound backend has no flush capability", async () => {
    const backend = new MemoryRepositoryBackend();
    const repository = new Repository({ backend });
    repository.init();
    const current = revisionedSnapshot("revision:11");
    const adapter = createAdapter(
      repository,
      new StaticRevisionedAuthority(current),
    );

    const result = await adapter.checkpoint(
      current.revision,
      "missing flush checkpoint",
    );

    expect(result.status).toBe("checkpointed");
    if (result.status !== "checkpointed") return;
    expect(result.receipt.durability).toBe("memory-accepted");
  });

  it.each(["object", "content"] as const)(
    "does not flush a backend when its active %s store is overridden",
    async (override) => {
      const backend = new FlushingMemoryBackend();
      const repository = new Repository({
        backend,
        ...(override === "object"
          ? { store: new MemoryObjectStore() }
          : { contentStore: new MemoryContentStore() }),
      });
      repository.init();
      const current = revisionedSnapshot(`revision:mixed-${override}`);
      const adapter = createAdapter(
        repository,
        new StaticRevisionedAuthority(current),
      );

      const result = await adapter.checkpoint(
        current.revision,
        "mixed store checkpoint",
      );

      expect(result.status).toBe("checkpointed");
      if (result.status !== "checkpointed") return;
      expect(result.receipt.durability).toBe("memory-accepted");
      expect(backend.flushCalls).toBe(0);
    },
  );

  it("ignores arbitrary flush functions smuggled through checkpoint options", async () => {
    const repository = new Repository();
    repository.init();
    const current = revisionedSnapshot("revision:12");
    const adapter = createAdapter(
      repository,
      new StaticRevisionedAuthority(current),
    );
    const injectedFlush = vi.fn();
    const options = {
      author: "characterization",
      flush: injectedFlush,
    } as unknown as { readonly author?: string };

    const result = await adapter.checkpoint(
      current.revision,
      "untrusted flush checkpoint",
      options,
    );

    expect(result.status).toBe("checkpointed");
    if (result.status !== "checkpointed") return;
    expect(result.receipt.durability).toBe("memory-accepted");
    expect(injectedFlush).not.toHaveBeenCalled();
  });

  it("maps a bound backend flush throw to indeterminate/flush", async () => {
    const backend = new ThrowingFlushBackend();
    const repository = new Repository({ backend });
    repository.init();
    const current = revisionedSnapshot("revision:13");
    const adapter = createAdapter(
      repository,
      new StaticRevisionedAuthority(current),
    );

    const result = await adapter.checkpoint(
      current.revision,
      "throwing flush checkpoint",
    );

    expect(result.status).toBe("indeterminate");
    if (result.status !== "indeterminate") return;
    expect(result).toMatchObject({
      phase: "flush",
      liveRevision: current.revision,
      headBefore: null,
      observedHead: repository.getHeadCommitId(),
      candidateCommitId: repository.getHeadCommitId(),
      historyState: "accepted",
      worktreeState: "restored",
      diagnostics: [
        {
          code: "revisioned-repository-checkpoint-flush-failed",
          message: "Repository backend flush failed after checkpoint commit",
        },
      ],
    });
    expect(backend.flushCalls).toBe(1);
  });

  it("re-observes HEAD when another commit lands while a failing flush is pending", async () => {
    const backend = new DeferredFlushBackend();
    const repository = new Repository({ backend });
    repository.init();
    const current = revisionedSnapshot("revision:14");
    const adapter = createAdapter(
      repository,
      new StaticRevisionedAuthority(current),
    );
    await adapter.open();
    const worktreeBefore = repository.vfs.getSnapshot();

    const checkpoint = adapter.checkpoint(
      current.revision,
      "deferred flush checkpoint",
    );
    await backend.flushStarted.promise;
    const candidateCommitId = repository.getHeadCommitId();
    expect(candidateCommitId).not.toBeNull();

    const latestHead = repository.commit("concurrent repository commit");
    expect(latestHead).not.toBe(candidateCommitId);
    backend.flushCompletion.reject(new Error("deferred backend flush failed"));

    const result = await checkpoint;

    expect(result.status).toBe("indeterminate");
    if (result.status !== "indeterminate") return;
    expect(result).toMatchObject({
      phase: "flush",
      candidateCommitId,
      observedHead: latestHead,
      historyState: "accepted",
      worktreeState: "restored",
    });
    expect(repository.getHeadCommitId()).toBe(latestHead);
    expect(repository.vfs.getSnapshot()).toEqual(worktreeBefore);
    expect(backend.flushCalls).toBe(1);
  });
});
