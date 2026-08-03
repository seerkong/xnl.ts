import {
  IDBFactory,
  IDBKeyRange as FakeIDBKeyRange,
  IDBObjectStore as FakeIDBObjectStore,
} from "fake-indexeddb";
import { parseXnl, type DataElementNode } from "xnl-core";
import { describe, expect, it, vi } from "vitest";
import {
  createIndexedDbRevisionedVfsAuthority,
  IndexedDbVfsPersistence,
  type RevisionedVfsSnapshot,
  VirtualFileSystem,
} from "../src/index";

const PERSISTED_AT = "2026-08-03T00:00:00.000Z";

function parseSnapshot(
  source = `<workspace #workspace state="seed">`,
): DataElementNode {
  const node = parseXnl(source).nodes[0];
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("Expected a DataElement snapshot fixture");
  }
  const candidate = node as Partial<DataElementNode>;
  if (
    candidate.kind !== "DataElement" ||
    typeof candidate.tag !== "string" ||
    !candidate.metadata
  ) {
    throw new Error("Expected a DataElement snapshot fixture");
  }
  return node as DataElementNode;
}

function candidateFrom(
  base: RevisionedVfsSnapshot,
  state: string,
): DataElementNode {
  const candidate = structuredClone(base.snapshot);
  candidate.metadata.state = state;
  return candidate;
}

function createAuthority(
  indexedDbFactory: IDBFactory,
  options: {
    authorityId?: string;
    initialSnapshot?: DataElementNode;
    revisionFactory?: (sequence: number) => string;
    dbName?: string;
  } = {},
) {
  return createIndexedDbRevisionedVfsAuthority({
    authorityId: options.authorityId ?? "document-workspace",
    initialSnapshot: options.initialSnapshot ?? parseSnapshot(),
    dbName: options.dbName ?? "revisioned-authority-test",
    indexedDbFactory,
    clock: () => PERSISTED_AT,
    revisionFactory:
      options.revisionFactory ?? ((sequence) => `revision:${sequence}`),
  });
}

describe("IndexedDB RevisionedVfsAuthority", () => {
  it("seeds once and reopens the exact persisted snapshot and revision", async () => {
    const indexedDbFactory = new IDBFactory();
    const first = await createAuthority(indexedDbFactory);
    const base = await first.read();
    const applied = await first.compareAndSwap({
      expectedRevision: base.revision,
      snapshot: candidateFrom(base, "persisted"),
    });

    expect(applied).toEqual({
      status: "applied",
      receipt: {
        previousRevision: {
          authorityId: "document-workspace",
          value: "revision:0",
        },
        revision: {
          authorityId: "document-workspace",
          value: "revision:1",
        },
        persistedAt: PERSISTED_AT,
        durability: "workspace",
      },
    });

    const reopened = await createAuthority(indexedDbFactory, {
      initialSnapshot: parseSnapshot(
        `<workspace #workspace state="must-not-replace-persisted">`,
      ),
    });
    expect(await reopened.read()).toEqual({
      revision: {
        authorityId: "document-workspace",
        value: "revision:1",
      },
      snapshot: candidateFrom(base, "persisted"),
    });
  });

  it("linearizes competing same-base writes from independent instances", async () => {
    const indexedDbFactory = new IDBFactory();
    const first = await createAuthority(indexedDbFactory);
    const second = await createAuthority(indexedDbFactory);
    const base = await first.read();

    const results = await Promise.all([
      first.compareAndSwap({
        expectedRevision: base.revision,
        snapshot: candidateFrom(base, "writer-a"),
      }),
      second.compareAndSwap({
        expectedRevision: base.revision,
        snapshot: candidateFrom(base, "writer-b"),
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "applied",
      "conflict",
    ]);
    const winner = results.find((result) => result.status === "applied");
    expect(winner?.status).toBe("applied");
    const reopened = await createAuthority(indexedDbFactory);
    const persisted = await reopened.read();
    expect(persisted.revision.value).toBe("revision:1");
    expect(["writer-a", "writer-b"]).toContain(
      persisted.snapshot.metadata.state,
    );
  });

  it("checks foreign and stale revisions before current semantic no-op", async () => {
    const indexedDbFactory = new IDBFactory();
    const authority = await createAuthority(indexedDbFactory);
    const foreign = await createAuthority(indexedDbFactory, {
      authorityId: "foreign-workspace",
    });
    const staleBase = await authority.read();
    const firstWrite = await authority.compareAndSwap({
      expectedRevision: staleBase.revision,
      snapshot: candidateFrom(staleBase, "current"),
    });
    expect(firstWrite.status).toBe("applied");
    const current = await authority.read();

    expect(
      await authority.compareAndSwap({
        expectedRevision: (await foreign.read()).revision,
        snapshot: candidateFrom(current, "foreign"),
      }),
    ).toEqual({ status: "conflict", actualRevision: current.revision });
    expect(
      await authority.compareAndSwap({
        expectedRevision: staleBase.revision,
        snapshot: structuredClone(current.snapshot),
      }),
    ).toEqual({ status: "conflict", actualRevision: current.revision });
    expect(
      await authority.compareAndSwap({
        expectedRevision: current.revision,
        snapshot: structuredClone(current.snapshot),
      }),
    ).toEqual({ status: "unchanged", revision: current.revision });
  });

  it("clones seeds, submissions, reads, and exposed revisions", async () => {
    const indexedDbFactory = new IDBFactory();
    const seed = parseSnapshot();
    const authority = await createAuthority(indexedDbFactory, {
      initialSnapshot: seed,
    });
    seed.metadata.state = "mutated-seed";

    const firstRead = await authority.read();
    firstRead.snapshot.metadata.state = "mutated-read";
    (firstRead.revision as { value: string }).value = "mutated-revision";
    const base = await authority.read();
    expect(base.snapshot.metadata.state).toBe("seed");
    expect(base.revision.value).toBe("revision:0");

    const candidate = candidateFrom(base, "submitted");
    const expectedRevision = structuredClone(base.revision);
    const pending = authority.compareAndSwap({
      expectedRevision,
      snapshot: candidate,
    });
    candidate.metadata.state = "mutated-after-submit";
    (expectedRevision as { value: string }).value = "mutated-after-submit";

    const result = await pending;
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    (result.receipt.revision as { value: string }).value = "mutated-receipt";
    expect(await authority.read()).toMatchObject({
      revision: { value: "revision:1" },
      snapshot: { metadata: { state: "submitted" } },
    });
  });

  it("does not advance after revision generation failure and can retry", async () => {
    const indexedDbFactory = new IDBFactory();
    let failSequenceOne = true;
    const authority = await createAuthority(indexedDbFactory, {
      revisionFactory: (sequence) => {
        if (sequence === 1 && failSequenceOne) {
          failSequenceOne = false;
          throw new Error("injected revision failure");
        }
        return `revision:${sequence}`;
      },
    });
    const base = await authority.read();
    const candidate = candidateFrom(base, "retry-target");

    const failed = await authority.compareAndSwap({
      expectedRevision: base.revision,
      snapshot: candidate,
    });
    expect(failed).toMatchObject({
      status: "failed",
      actualRevision: base.revision,
      diagnostics: [{ code: "INDEXEDDB_REVISIONED_VFS_FLUSH_FAILED" }],
    });
    expect(await authority.read()).toEqual(base);

    const retried = await authority.compareAndSwap({
      expectedRevision: base.revision,
      snapshot: candidate,
    });
    expect(retried).toMatchObject({
      status: "applied",
      receipt: { durability: "workspace" },
    });
    expect((await authority.read()).snapshot.metadata.state).toBe(
      "retry-target",
    );
  });

  it("does not advance after a real IndexedDB transaction abort and reopens for retry", async () => {
    const indexedDbFactory = new IDBFactory();
    const authority = await createAuthority(indexedDbFactory);
    const base = await authority.read();
    const candidate = candidateFrom(base, "transaction-retry-target");
    const originalPut = FakeIDBObjectStore.prototype.put;
    const putSpy = vi
      .spyOn(FakeIDBObjectStore.prototype, "put")
      .mockImplementationOnce(function abortingPut(
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ): IDBRequest<IDBValidKey> {
        const request = key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key);
        this.transaction.abort();
        return request;
      });

    const failed = await authority.compareAndSwap({
      expectedRevision: base.revision,
      snapshot: candidate,
    });
    putSpy.mockRestore();
    expect(failed).toMatchObject({
      status: "failed",
      actualRevision: base.revision,
      diagnostics: [{ code: "INDEXEDDB_REVISIONED_VFS_FLUSH_FAILED" }],
    });

    const reopened = await createAuthority(indexedDbFactory);
    expect(await reopened.read()).toEqual(base);
    await expect(
      reopened.compareAndSwap({
        expectedRevision: base.revision,
        snapshot: candidate,
      }),
    ).resolves.toMatchObject({
      status: "applied",
      receipt: { durability: "workspace" },
    });
  });

  it("shares one upgraded database schema with ordinary IndexedDB persistence", async () => {
    const persistenceFirstFactory = new IDBFactory();
    const persistenceFirst = new IndexedDbVfsPersistence({
      dbName: "revisioned-authority-test",
      indexedDbFactory: persistenceFirstFactory,
    });
    await expect(persistenceFirst.loadSnapshot()).resolves.toMatchObject({
      warnings: [],
      dirty: false,
    });
    await expect(
      createAuthority(persistenceFirstFactory),
    ).resolves.toBeDefined();

    const authorityFirstFactory = new IDBFactory();
    await createAuthority(authorityFirstFactory);
    const persistenceSecond = new IndexedDbVfsPersistence({
      dbName: "revisioned-authority-test",
      indexedDbFactory: authorityFirstFactory,
    });
    await expect(persistenceSecond.loadSnapshot()).resolves.toMatchObject({
      warnings: [],
      dirty: false,
    });
  });

  it("upgrades a populated legacy version-one database without losing VFS data", async () => {
    const indexedDbFactory = new IDBFactory();
    const dbName = "legacy-version-one-upgrade";
    vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
    try {
      await createLegacyVersionOneDatabase(indexedDbFactory, dbName);
      const legacyPersistence = new IndexedDbVfsPersistence({
        dbName,
        dbVersion: 1,
        workspaceId: "legacy-workspace",
        indexedDbFactory,
      });
      const legacyVfs = new VirtualFileSystem();
      legacyVfs.writeFile("vfs:///preserved.txt", "legacy-data", {
        fileType: "text",
      });
      await legacyPersistence.saveFromVfs(legacyVfs);

      await createAuthority(indexedDbFactory, { dbName });
      const upgradedPersistence = new IndexedDbVfsPersistence({
        dbName,
        workspaceId: "legacy-workspace",
        indexedDbFactory,
      });
      const reopenedVfs = new VirtualFileSystem();
      await upgradedPersistence.loadIntoVfs(reopenedVfs);
      expect(reopenedVfs.readFile("vfs:///preserved.txt")).toBe("legacy-data");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

async function createLegacyVersionOneDatabase(
  indexedDbFactory: IDBFactory,
  dbName: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDbFactory.open(dbName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const nodes = database.createObjectStore("vfs-nodes", {
        keyPath: "metadataId",
      });
      nodes.createIndex("by-parent", "parentMetadataId", { unique: false });
      nodes.createIndex("by-path", "path", { unique: false });
      nodes.createIndex("by-workspace", "workspaceId", { unique: false });
      database.createObjectStore("vfs-contents", { keyPath: "metadataId" });
      database.createObjectStore("vfs-workspaces", { keyPath: "workspaceId" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
}
