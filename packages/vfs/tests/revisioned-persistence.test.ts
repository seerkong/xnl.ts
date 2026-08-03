import {
  parseXnl,
  type DataElementNode,
  type XnlMutation,
  type XnlMutationBatch,
  type XnlMutationBatchOptions,
  type XnlMutationDiagnostic,
  type XnlWord,
} from "xnl-core";
import { describe, expect, it, vi } from "vitest";
import * as vfsModule from "../src/index";

type Awaitable<T> = T | PromiseLike<T>;

interface VfsRevision {
  readonly authorityId: string;
  readonly value: string;
}

interface RevisionedVfsSnapshot {
  readonly revision: VfsRevision;
  readonly snapshot: DataElementNode;
}

interface RevisionedPersistenceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

interface RevisionedVfsReceipt {
  readonly previousRevision: VfsRevision;
  readonly revision: VfsRevision;
  readonly persistedAt: string;
  readonly durability: "memory" | "workspace";
}

type RevisionedVfsCompareAndSwapResult =
  | { readonly status: "applied"; readonly receipt: RevisionedVfsReceipt }
  | { readonly status: "unchanged"; readonly revision: VfsRevision }
  | { readonly status: "conflict"; readonly actualRevision: VfsRevision }
  | {
      readonly status: "failed";
      readonly actualRevision: VfsRevision;
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
    };

interface RevisionedVfsAuthority {
  read(): Awaitable<RevisionedVfsSnapshot>;
  compareAndSwap(input: {
    readonly expectedRevision: VfsRevision;
    readonly snapshot: DataElementNode;
  }): Awaitable<RevisionedVfsCompareAndSwapResult>;
}

interface MemoryRevisionedVfsAuthority extends RevisionedVfsAuthority {
  failNextFlush(diagnostic: RevisionedPersistenceDiagnostic): void;
}

interface MemoryRevisionedVfsAuthorityOptions {
  readonly authorityId: string;
  readonly clock?: () => string;
  readonly revisionFactory?: (sequence: number) => string;
}

type MemoryRevisionedVfsAuthorityConstructor = new (
  initialSnapshot: DataElementNode,
  options: MemoryRevisionedVfsAuthorityOptions,
) => MemoryRevisionedVfsAuthority;

interface ApplyRevisionedVfsMutationsInput {
  readonly base: RevisionedVfsSnapshot;
  readonly mutations: XnlMutationBatch;
  readonly mutationOptions?: Omit<XnlMutationBatchOptions, "metadataIdMode">;
}

type ApplyRevisionedVfsMutationsResult =
  | {
      readonly status: "applied";
      readonly snapshot: DataElementNode;
      readonly receipt: RevisionedVfsReceipt;
    }
  | {
      readonly status: "unchanged";
      readonly snapshot: DataElementNode;
      readonly revision: VfsRevision;
    }
  | { readonly status: "conflict"; readonly actualRevision: VfsRevision }
  | {
      readonly status: "rejected";
      readonly base: RevisionedVfsSnapshot;
      readonly diagnostics: readonly XnlMutationDiagnostic[];
    }
  | {
      readonly status: "failed";
      readonly actualRevision: VfsRevision;
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
    };

type ApplyRevisionedVfsMutations = (
  authority: RevisionedVfsAuthority,
  input: ApplyRevisionedVfsMutationsInput,
) => Awaitable<ApplyRevisionedVfsMutationsResult>;

interface RevisionedPersistenceModule {
  readonly MemoryRevisionedVfsAuthority: MemoryRevisionedVfsAuthorityConstructor;
  readonly applyRevisionedVfsMutations: ApplyRevisionedVfsMutations;
}

const PERSISTED_AT = "2026-07-31T00:00:00.000Z";

function revisionedPersistence(): RevisionedPersistenceModule {
  const Authority = Reflect.get(vfsModule, "MemoryRevisionedVfsAuthority");
  const apply = Reflect.get(vfsModule, "applyRevisionedVfsMutations");
  if (typeof Authority !== "function") {
    throw new Error(
      "Expected xnl-vfs to export MemoryRevisionedVfsAuthority",
    );
  }
  if (typeof apply !== "function") {
    throw new Error("Expected xnl-vfs to export applyRevisionedVfsMutations");
  }
  return {
    MemoryRevisionedVfsAuthority:
      Authority as MemoryRevisionedVfsAuthorityConstructor,
    applyRevisionedVfsMutations: apply as ApplyRevisionedVfsMutations,
  };
}

function parseSnapshot(source: string): DataElementNode {
  const node = parseXnl(source).nodes[0];
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("Expected a DataElement snapshot fixture");
  }
  const candidate = node as Partial<DataElementNode>;
  if (candidate.kind !== "DataElement" || typeof candidate.tag !== "string" || !candidate.metadata) {
    throw new Error("Expected a DataElement snapshot fixture");
  }
  return node as DataElementNode;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function word(name: string): XnlWord {
  return { kind: "Word", namespace: [], name };
}

function createAuthority(
  snapshot = parseSnapshot(`<workspace #workspace state="draft">`),
  authorityId = "authority-a",
): MemoryRevisionedVfsAuthority {
  const { MemoryRevisionedVfsAuthority } = revisionedPersistence();
  return new MemoryRevisionedVfsAuthority(snapshot, {
    authorityId,
    clock: () => PERSISTED_AT,
    revisionFactory: (sequence) => `revision:${sequence}`,
  });
}

function updateState(value: string): XnlMutation {
  return {
    type: "OBJECT_UPDATE",
    path: ":metadata::'state'",
    valueAfter: value,
  };
}

async function applyState(
  authority: RevisionedVfsAuthority,
  base: RevisionedVfsSnapshot,
  value: string,
): Promise<ApplyRevisionedVfsMutationsResult> {
  const { applyRevisionedVfsMutations } = revisionedPersistence();
  return await applyRevisionedVfsMutations(authority, {
    base,
    mutations: [updateState(value)],
  });
}

describe("revisioned VFS persistence characterization", () => {
  describe("closed apply outcomes", () => {
    it("returns applied only after persistence and keeps the caller base immutable", async () => {
      const authority = createAuthority();
      const base = await authority.read();
      const baseBefore = clone(base);

      const result = await applyState(authority, base, "saved");

      expect(result.status).toBe("applied");
      if (result.status !== "applied") return;
      expect(result.snapshot.metadata.state).toBe("saved");
      expect(result.snapshot).not.toBe(base.snapshot);
      expect(result.receipt.previousRevision).toEqual(base.revision);
      expect(result.receipt.revision.authorityId).toBe(base.revision.authorityId);
      expect(result.receipt.revision.value).not.toBe(base.revision.value);
      expect(result.receipt.persistedAt).toBe(PERSISTED_AT);
      expect(result.receipt.durability).toBe("memory");
      expect(result.receipt).not.toHaveProperty("commitId");
      expect(base).toEqual(baseBefore);

      const persisted = await authority.read();
      expect(persisted).toEqual({
        revision: result.receipt.revision,
        snapshot: result.snapshot,
      });
    });

    it("returns unchanged for a current semantic no-op without advancing revision", async () => {
      const authority = createAuthority();
      const base = await authority.read();
      const writer = vi.spyOn(authority, "compareAndSwap");
      const { applyRevisionedVfsMutations } = revisionedPersistence();

      const result = await applyRevisionedVfsMutations(authority, {
        base,
        mutations: [],
      });

      expect(result.status).toBe("unchanged");
      if (result.status !== "unchanged") return;
      expect(writer).toHaveBeenCalledTimes(1);
      expect(result.revision).toEqual(base.revision);
      expect(result.snapshot).toEqual(base.snapshot);
      expect(await authority.read()).toEqual(base);
    });

    it("returns conflict for a stale writer without replacing the winner", async () => {
      const authority = createAuthority();
      const staleBase = await authority.read();
      const winner = await applyState(authority, staleBase, "winner");
      expect(winner.status).toBe("applied");
      if (winner.status !== "applied") return;
      const afterWinner = await authority.read();

      const result = await applyState(authority, staleBase, "loser");

      expect(result).toEqual({
        status: "conflict",
        actualRevision: winner.receipt.revision,
      });
      expect(await authority.read()).toEqual(afterWinner);
    });

    it("returns rejected before authority invocation and preserves the base", async () => {
      const authority = createAuthority();
      const base = await authority.read();
      const baseBefore = clone(base);
      const writer = vi.spyOn(authority, "compareAndSwap");
      const { applyRevisionedVfsMutations } = revisionedPersistence();

      const result = await applyRevisionedVfsMutations(authority, {
        base,
        mutations: [
          {
            type: "OBJECT_UPDATE",
            path: ":id",
            valueBefore: word("workspace"),
            valueAfter: word("replacement"),
          },
        ],
      });

      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") return;
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "IDENTITY_MUTATION_FORBIDDEN",
      );
      expect(result.base).toEqual(baseBefore);
      expect(writer).not.toHaveBeenCalled();
      expect(await authority.read()).toEqual(baseBefore);
    });

    it("returns failed without advance and permits retry from the same truthful base", async () => {
      const authority = createAuthority();
      const base = await authority.read();
      authority.failNextFlush({
        code: "TEST_FLUSH_FAILURE",
        message: "injected flush failure",
      });

      const failed = await applyState(authority, base, "saved");

      expect(failed.status).toBe("failed");
      if (failed.status !== "failed") return;
      expect(failed.actualRevision).toEqual(base.revision);
      expect(failed.diagnostics).toContainEqual(
        expect.objectContaining({ code: "TEST_FLUSH_FAILURE" }),
      );
      expect(await authority.read()).toEqual(base);

      const retried = await applyState(authority, base, "saved");
      expect(retried.status).toBe("applied");
      if (retried.status !== "applied") return;
      expect(retried.receipt.previousRevision).toEqual(base.revision);
      expect(retried.receipt.revision).not.toEqual(base.revision);
      expect((await authority.read()).revision).toEqual(retried.receipt.revision);
    });
  });

  describe("authority CAS boundaries", () => {
    it("conflicts a stale semantic no-op instead of bypassing authority CAS", async () => {
      const authority = createAuthority();
      const staleBase = await authority.read();
      const winner = await applyState(authority, staleBase, "winner");
      expect(winner.status).toBe("applied");
      if (winner.status !== "applied") return;
      const afterWinner = await authority.read();
      const { applyRevisionedVfsMutations } = revisionedPersistence();

      const result = await applyRevisionedVfsMutations(authority, {
        base: staleBase,
        mutations: [],
      });

      expect(result).toEqual({
        status: "conflict",
        actualRevision: winner.receipt.revision,
      });
      expect(await authority.read()).toEqual(afterWinner);
    });

    it("linearizes concurrent same-base writes to exactly one applied and one conflict", async () => {
      const authority = createAuthority();
      const base = await authority.read();
      const candidates = ["first", "second"].map((state) => {
        const snapshot = clone(base.snapshot);
        snapshot.metadata.state = state;
        return snapshot;
      });

      const results = await Promise.all(
        candidates.map(async (snapshot) =>
          await authority.compareAndSwap({
            expectedRevision: base.revision,
            snapshot,
          }),
        ),
      );

      expect(results.map((result) => result.status).sort()).toEqual([
        "applied",
        "conflict",
      ]);
      const winnerIndex = results.findIndex((result) => result.status === "applied");
      const winner = results[winnerIndex];
      if (!winner || winner.status !== "applied") {
        throw new Error("Expected one concurrent CAS winner");
      }
      expect(await authority.read()).toEqual({
        revision: winner.receipt.revision,
        snapshot: candidates[winnerIndex],
      });
    });

    it("rejects a same-valued revision token from another authority", async () => {
      const authorityA = createAuthority(undefined, "authority-a");
      const authorityB = createAuthority(undefined, "authority-b");
      const revisionA = (await authorityA.read()).revision;
      const beforeB = await authorityB.read();
      const candidate = clone(beforeB.snapshot);
      candidate.metadata.state = "foreign-write";

      expect(revisionA.value).toBe(beforeB.revision.value);
      const result = await authorityB.compareAndSwap({
        expectedRevision: revisionA,
        snapshot: candidate,
      });

      expect(result).toEqual({
        status: "conflict",
        actualRevision: beforeB.revision,
      });
      expect(await authorityB.read()).toEqual(beforeB);
    });

    it.each([
      {
        label: "explicit #id value",
        source: `<workspace #workspace state="draft">`,
        mutate(snapshot: DataElementNode) {
          snapshot.id = word("replacement");
        },
      },
      {
        label: "effective metadata fallback value",
        source: `<workspace id="workspace" state="draft">`,
        mutate(snapshot: DataElementNode) {
          snapshot.metadata.id = "replacement";
        },
      },
      {
        label: "same-value explicit-to-fallback authority transition",
        source: `<workspace #workspace state="draft">`,
        mutate(snapshot: DataElementNode) {
          delete snapshot.id;
          snapshot.metadata.id = "workspace";
        },
      },
    ])("treats an identity-only $label change as non-noop", async ({ source, mutate }) => {
      const authority = createAuthority(parseSnapshot(source));
      const base = await authority.read();
      const candidate = clone(base.snapshot);
      mutate(candidate);

      const result = await authority.compareAndSwap({
        expectedRevision: base.revision,
        snapshot: candidate,
      });

      expect(result.status).toBe("applied");
      if (result.status !== "applied") return;
      expect(result.receipt.revision).not.toEqual(base.revision);
      expect(await authority.read()).toEqual({
        revision: result.receipt.revision,
        snapshot: candidate,
      });
    });
  });

  describe("strict identity rejection before authority write", () => {
    it.each([
      {
        surface: "direct #id",
        operation: "add",
        source: `<root #root [ <item> ]>`,
        mutation: {
          type: "OBJECT_ADD",
          path: "#root:body::0:id",
          valueAfter: word("assigned"),
        } satisfies XnlMutation,
      },
      {
        surface: "direct #id",
        operation: "update",
        source: `<root #root [ <item #stable> ]>`,
        mutation: {
          type: "OBJECT_UPDATE",
          path: "#stable:id",
          valueBefore: word("stable"),
          valueAfter: word("renamed"),
        } satisfies XnlMutation,
      },
      {
        surface: "direct #id",
        operation: "delete",
        source: `<root #root [ <item #stable> ]>`,
        mutation: {
          type: "OBJECT_DELETE",
          path: "#stable:id",
          valueBefore: word("stable"),
        } satisfies XnlMutation,
      },
      {
        surface: "effective metadata.id",
        operation: "add",
        source: `<item>`,
        mutation: {
          type: "OBJECT_ADD",
          path: ":metadata::'id'",
          valueAfter: "assigned",
        } satisfies XnlMutation,
      },
      {
        surface: "effective metadata.id",
        operation: "update",
        source: `<item id="stable">`,
        mutation: {
          type: "OBJECT_UPDATE",
          path: ":metadata::'id'",
          valueBefore: "stable",
          valueAfter: "renamed",
        } satisfies XnlMutation,
      },
      {
        surface: "effective metadata.id",
        operation: "delete",
        source: `<item id="stable">`,
        mutation: {
          type: "OBJECT_DELETE",
          path: ":metadata::'id'",
          valueBefore: "stable",
        } satisfies XnlMutation,
      },
    ])("rejects $surface $operation with zero authority calls", async ({ source, mutation }) => {
      const authority = createAuthority(parseSnapshot(source));
      const base = await authority.read();
      const baseBefore = clone(base);
      const writer = vi.spyOn(authority, "compareAndSwap");
      const { applyRevisionedVfsMutations } = revisionedPersistence();
      const escapedOptions = {
        identityPolicy: "allow-missing",
        metadataIdMode: "metadata",
      } as unknown as ApplyRevisionedVfsMutationsInput["mutationOptions"];

      const result = await applyRevisionedVfsMutations(authority, {
        base,
        mutations: [mutation],
        mutationOptions: escapedOptions,
      });

      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") return;
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "IDENTITY_MUTATION_FORBIDDEN",
      );
      expect(result.base).toEqual(baseBefore);
      expect(base).toEqual(baseBefore);
      expect(writer).not.toHaveBeenCalled();
      expect(await authority.read()).toEqual(baseBefore);
    });
  });
});
