import type {
  DataElementNode,
  XnlMutation,
  XnlMutationBatch,
} from "xnl-core";
import {
  applyRevisionedVfsMutations,
  MemoryRevisionedVfsAuthority,
  VirtualFileSystem,
  type RevisionedVfsAuthority,
  type RevisionedVfsFlushInput,
  type RevisionedVfsCompareAndSwapResult,
  type RevisionedVfsSnapshot,
} from "xnl-vfs";
import { describe, expect, it, vi } from "vitest";
import { Repository } from "../src/repository";
import {
  RevisionedRepositoryAdapter,
  type RevisionedRepositoryApplyInput,
  type RevisionedRepositoryApplyResult,
  type RevisionedRepositoryOpenResult,
} from "../src/revisioned-repository";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function workspaceSnapshot(
  state = "draft",
  content = "export const value = 1;",
): DataElementNode {
  const vfs = new VirtualFileSystem();
  vfs.mkdir("vfs:///src", { recursive: true });
  vfs.writeFile("vfs:///src/main.ts", content, { fileType: "text" });
  const snapshot = vfs.getSnapshot();
  snapshot.metadata.state = state;
  return snapshot;
}

function createAuthority(
  snapshot = workspaceSnapshot(),
): MemoryRevisionedVfsAuthority {
  return new MemoryRevisionedVfsAuthority(snapshot, {
    authorityId: "authority-a",
    clock: () => "2026-07-31T00:00:00.000Z",
    revisionFactory: (sequence) => `revision:${sequence}`,
  });
}

function createRepositoryWithHistory(): Repository {
  const repository = new Repository();
  repository.init();
  repository.vfs.loadSnapshot(workspaceSnapshot("history"));
  repository.commit("baseline");
  return repository;
}

function updateState(value: string): XnlMutationBatch {
  return [
    {
      type: "OBJECT_UPDATE",
      path: ":metadata::'state'",
      valueAfter: value,
    },
  ];
}

function setWorktreeState(repository: Repository, state: string): void {
  const snapshot = repository.vfs.getSnapshot();
  snapshot.metadata.state = state;
  repository.vfs.loadSnapshot(snapshot);
}

function captureRepository(repository: Repository): {
  snapshot: DataElementNode;
  head: string | null;
  objects: string[];
} {
  return {
    snapshot: repository.vfs.getSnapshot(),
    head: repository.getHeadCommitId(),
    objects: repository.store.list(),
  };
}

function expectRepository(
  repository: Repository,
  expected: ReturnType<typeof captureRepository>,
): void {
  expect(repository.vfs.getSnapshot()).toEqual(expected.snapshot);
  expect(repository.getHeadCommitId()).toBe(expected.head);
  expect(repository.store.list()).toEqual(expected.objects);
}

class ReferenceLeakingAuthority implements RevisionedVfsAuthority {
  constructor(private readonly current: RevisionedVfsSnapshot) {}

  read(): RevisionedVfsSnapshot {
    return this.current;
  }

  compareAndSwap(
    _input: RevisionedVfsFlushInput,
  ): RevisionedVfsCompareAndSwapResult {
    throw new Error("open must not write the authority");
  }

  peek(): RevisionedVfsSnapshot {
    return clone(this.current);
  }
}

describe("RevisionedRepositoryAdapter open/apply", () => {
  it("opens the real authority pair without leaking mutable references or changing history", async () => {
    const repository = createRepositoryWithHistory();
    const authority = new ReferenceLeakingAuthority({
      revision: { authorityId: "authority-a", value: "revision:7" },
      snapshot: workspaceSnapshot("authority"),
    });
    const beforeHead = repository.getHeadCommitId();
    const beforeObjects = repository.store.list();
    const adapter = new RevisionedRepositoryAdapter({ repository, authority });

    const opened: RevisionedRepositoryOpenResult = await adapter.open();

    expect(opened).toEqual(authority.peek());
    expect(opened).not.toHaveProperty("commitId");
    expect(repository.vfs.getSnapshot()).toEqual(opened.snapshot);
    expect(repository.getHeadCommitId()).toBe(beforeHead);
    expect(repository.store.list()).toEqual(beforeObjects);

    opened.snapshot.metadata.state = "mutated-result";
    (opened.revision as { value: string }).value = "mutated-revision";
    expect(authority.peek().snapshot.metadata.state).toBe("authority");
    expect(authority.peek().revision.value).toBe("revision:7");
    expect(repository.vfs.getSnapshot().metadata.state).toBe("authority");
  });

  it("loads only an applied accepted snapshot and keeps live revision separate from history", async () => {
    const repository = createRepositoryWithHistory();
    const authority = createAuthority();
    const adapter = new RevisionedRepositoryAdapter({ repository, authority });
    const base = await adapter.open();
    setWorktreeState(repository, "out-of-band");
    const historyBefore = {
      head: repository.getHeadCommitId(),
      objects: repository.store.list(),
    };
    const input: RevisionedRepositoryApplyInput = {
      base,
      mutations: updateState("saved"),
    };

    const result: RevisionedRepositoryApplyResult = await adapter.apply(input);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(repository.vfs.getSnapshot()).toEqual(result.snapshot);
    expect(repository.vfs.getSnapshot().metadata.state).toBe("saved");
    expect((await authority.read()).snapshot).toEqual(result.snapshot);
    expect(result.receipt).not.toHaveProperty("commitId");
    expect(result).not.toHaveProperty("commitId");
    expect(repository.getHeadCommitId()).toBe(historyBefore.head);
    expect(repository.store.list()).toEqual(historyBefore.objects);

    result.snapshot.metadata.state = "mutated-result";
    expect(repository.vfs.getSnapshot().metadata.state).toBe("saved");
  });

  it("preserves an out-of-band worktree and history for unchanged", async () => {
    const repository = createRepositoryWithHistory();
    const authority = createAuthority();
    const adapter = new RevisionedRepositoryAdapter({ repository, authority });
    const base = await adapter.open();
    setWorktreeState(repository, "out-of-band");
    const before = captureRepository(repository);

    const result = await adapter.apply({ base, mutations: [] });

    expect(result.status).toBe("unchanged");
    expectRepository(repository, before);
  });

  it("preserves worktree and history for stale conflict", async () => {
    const repository = createRepositoryWithHistory();
    const authority = createAuthority();
    const adapter = new RevisionedRepositoryAdapter({ repository, authority });
    const staleBase = await adapter.open();
    const winner = await applyRevisionedVfsMutations(authority, {
      base: staleBase,
      mutations: updateState("winner"),
    });
    expect(winner.status).toBe("applied");
    setWorktreeState(repository, "out-of-band");
    const before = captureRepository(repository);

    const result = await adapter.apply({
      base: staleBase,
      mutations: updateState("loser"),
    });

    expect(result.status).toBe("conflict");
    expectRepository(repository, before);
  });

  it("preserves worktree and history when strict identity mutation is rejected", async () => {
    const repository = createRepositoryWithHistory();
    const authority = createAuthority();
    const writer = vi.spyOn(authority, "compareAndSwap");
    const adapter = new RevisionedRepositoryAdapter({ repository, authority });
    const base = await adapter.open();
    setWorktreeState(repository, "out-of-band");
    const before = captureRepository(repository);
    const identityMutation: XnlMutation = {
      type: "OBJECT_UPDATE",
      path: ":metadata::'id'",
      valueBefore: base.snapshot.metadata.id,
      valueAfter: "replacement",
    };

    const result = await adapter.apply({
      base,
      mutations: [identityMutation],
    });

    expect(result.status).toBe("rejected");
    expect(writer).not.toHaveBeenCalled();
    expectRepository(repository, before);
  });

  it("preserves worktree and history when the authority reports failed", async () => {
    const repository = createRepositoryWithHistory();
    const authority = createAuthority();
    const adapter = new RevisionedRepositoryAdapter({ repository, authority });
    const base = await adapter.open();
    setWorktreeState(repository, "out-of-band");
    const before = captureRepository(repository);
    authority.failNextFlush({
      code: "TEST_FLUSH_FAILURE",
      message: "injected authority failure",
    });

    const result = await adapter.apply({
      base,
      mutations: updateState("failed"),
    });

    expect(result.status).toBe("failed");
    expectRepository(repository, before);
  });
});
