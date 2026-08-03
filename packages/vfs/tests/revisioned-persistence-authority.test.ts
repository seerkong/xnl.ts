import { parseXnl, type DataElementNode } from "xnl-core";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryRevisionedVfsAuthority,
  type RevisionedVfsSnapshot,
} from "../src/index";

const PERSISTED_AT = "2026-07-31T00:00:00.000Z";

function parseSnapshot(
  source = `<workspace #workspace state="draft">`,
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function candidateFrom(
  base: RevisionedVfsSnapshot,
  state: string,
): DataElementNode {
  const candidate = clone(base.snapshot);
  candidate.metadata.state = state;
  return candidate;
}

function createAuthority(
  snapshot = parseSnapshot(),
  authorityId = "authority-a",
): MemoryRevisionedVfsAuthority {
  return new MemoryRevisionedVfsAuthority(snapshot, {
    authorityId,
    clock: () => PERSISTED_AT,
    revisionFactory: (sequence) => `revision:${sequence}`,
  });
}

describe("MemoryRevisionedVfsAuthority", () => {
  it("starts with the default revision:0 authority-qualified token", async () => {
    const authority = new MemoryRevisionedVfsAuthority(parseSnapshot(), {
      authorityId: "authority-default",
    });

    expect((await authority.read()).revision).toEqual({
      authorityId: "authority-default",
      value: "revision:0",
    });
  });

  it("advances one sequence and returns a complete truthful memory receipt", async () => {
    const revisionFactory = vi.fn(
      (sequence: number) => `custom-revision:${sequence}`,
    );
    const clock = vi.fn(() => PERSISTED_AT);
    const authority = new MemoryRevisionedVfsAuthority(parseSnapshot(), {
      authorityId: "authority-a",
      clock,
      revisionFactory,
    });
    const base = await authority.read();
    const candidate = candidateFrom(base, "saved");

    const result = await authority.compareAndSwap({
      expectedRevision: base.revision,
      snapshot: candidate,
    });

    expect(result).toEqual({
      status: "applied",
      receipt: {
        previousRevision: {
          authorityId: "authority-a",
          value: "custom-revision:0",
        },
        revision: {
          authorityId: "authority-a",
          value: "custom-revision:1",
        },
        persistedAt: PERSISTED_AT,
        durability: "memory",
      },
    });
    expect(revisionFactory.mock.calls).toEqual([[0], [1]]);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(await authority.read()).toEqual({
      revision: {
        authorityId: "authority-a",
        value: "custom-revision:1",
      },
      snapshot: candidate,
    });
  });

  it("clones initial state, submissions, reads, and exposed receipt revisions", async () => {
    const initial = parseSnapshot();
    const authority = createAuthority(initial);
    initial.metadata.state = "mutated-after-construction";

    const firstRead = await authority.read();
    expect(firstRead.snapshot.metadata.state).toBe("draft");
    firstRead.snapshot.metadata.state = "mutated-read";
    (firstRead.revision as { value: string }).value = "mutated-read-revision";

    const base = await authority.read();
    expect(base.snapshot.metadata.state).toBe("draft");
    expect(base.revision.value).toBe("revision:0");

    const submittedCandidate = candidateFrom(base, "submitted");
    const submittedRevision = clone(base.revision);
    const pending = authority.compareAndSwap({
      expectedRevision: submittedRevision,
      snapshot: submittedCandidate,
    });
    submittedCandidate.metadata.state = "mutated-after-submit";
    (submittedRevision as { value: string }).value = "mutated-after-submit";

    const result = await pending;
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect((await authority.read()).snapshot.metadata.state).toBe("submitted");

    (result.receipt.previousRevision as { value: string }).value =
      "mutated-previous";
    (result.receipt.revision as { value: string }).value = "mutated-current";

    expect((await authority.read()).revision).toEqual({
      authorityId: "authority-a",
      value: "revision:1",
    });
  });

  it("serializes concurrent same-base writers to one applied and one conflict", async () => {
    const authority = createAuthority();
    const base = await authority.read();
    const candidates = [
      candidateFrom(base, "first"),
      candidateFrom(base, "second"),
    ];

    const results = await Promise.all(
      candidates.map((snapshot) =>
        authority.compareAndSwap({
          expectedRevision: base.revision,
          snapshot,
        }),
      ),
    );

    expect(results.map(({ status }) => status).sort()).toEqual([
      "applied",
      "conflict",
    ]);
    const winnerIndex = results.findIndex(({ status }) => status === "applied");
    const winner = results[winnerIndex];
    if (!winner || winner.status !== "applied") {
      throw new Error("Expected exactly one applied result");
    }
    expect(await authority.read()).toEqual({
      revision: winner.receipt.revision,
      snapshot: candidates[winnerIndex],
    });
  });

  it("rejects nonconsecutive revision reuse without reopening a stale ABA token", async () => {
    const revisionFactory = vi.fn((sequence: number) =>
      ["r0", "r1", "r0"][sequence] ?? `r${sequence}`,
    );
    const clock = vi.fn(() => PERSISTED_AT);
    const authority = new MemoryRevisionedVfsAuthority(parseSnapshot(), {
      authorityId: "authority-aba",
      clock,
      revisionFactory,
    });
    const original = await authority.read();
    const firstWrite = await authority.compareAndSwap({
      expectedRevision: original.revision,
      snapshot: candidateFrom(original, "first"),
    });
    expect(firstWrite.status).toBe("applied");
    const current = await authority.read();

    const duplicate = await authority.compareAndSwap({
      expectedRevision: current.revision,
      snapshot: candidateFrom(current, "duplicate"),
    });

    expect(duplicate).toMatchObject({
      status: "failed",
      actualRevision: current.revision,
      diagnostics: [
        {
          code: "MEMORY_REVISIONED_VFS_FLUSH_FAILED",
          message: "Memory revisioned VFS flush failed",
        },
      ],
    });
    if (duplicate.status !== "failed") return;
    expect(duplicate.diagnostics[0]?.cause).toBeInstanceOf(Error);
    expect((duplicate.diagnostics[0]?.cause as Error).message).toContain(
      "must not reuse",
    );
    expect(await authority.read()).toEqual(current);
    expect(revisionFactory.mock.calls).toEqual([[0], [1], [2]]);
    expect(clock).toHaveBeenCalledTimes(1);

    const repeatedDuplicate = await authority.compareAndSwap({
      expectedRevision: current.revision,
      snapshot: candidateFrom(current, "repeated-duplicate"),
    });
    expect(repeatedDuplicate.status).toBe("failed");
    expect(revisionFactory.mock.calls).toEqual([[0], [1], [2], [2]]);
    expect(await authority.read()).toEqual(current);

    const stale = await authority.compareAndSwap({
      expectedRevision: original.revision,
      snapshot: candidateFrom(current, "stale"),
    });
    expect(stale).toEqual({
      status: "conflict",
      actualRevision: current.revision,
    });
    expect(await authority.read()).toEqual(current);
  });

  it("treats an identity-authority transition as a structural replacement", async () => {
    const authority = createAuthority();
    const base = await authority.read();
    const candidate = clone(base.snapshot);
    delete candidate.id;
    candidate.metadata.id = "workspace";

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

  it("checks scope and freshness before no-op and replace failure consumption", async () => {
    const authority = createAuthority();
    const foreignAuthority = createAuthority(undefined, "authority-b");
    const staleBase = await authority.read();
    const firstWrite = await authority.compareAndSwap({
      expectedRevision: staleBase.revision,
      snapshot: candidateFrom(staleBase, "first"),
    });
    expect(firstWrite.status).toBe("applied");
    if (firstWrite.status !== "applied") return;
    const current = await authority.read();
    authority.failNextFlush({
      code: "TEST_FLUSH_FAILURE",
      message: "injected failure",
    });

    const foreign = await authority.compareAndSwap({
      expectedRevision: (await foreignAuthority.read()).revision,
      snapshot: candidateFrom(current, "foreign"),
    });
    const stale = await authority.compareAndSwap({
      expectedRevision: staleBase.revision,
      snapshot: candidateFrom(current, "stale"),
    });
    const unchanged = await authority.compareAndSwap({
      expectedRevision: current.revision,
      snapshot: clone(current.snapshot),
    });
    const failed = await authority.compareAndSwap({
      expectedRevision: current.revision,
      snapshot: candidateFrom(current, "failed"),
    });

    expect(foreign).toEqual({
      status: "conflict",
      actualRevision: current.revision,
    });
    expect(stale).toEqual({
      status: "conflict",
      actualRevision: current.revision,
    });
    expect(unchanged).toEqual({
      status: "unchanged",
      revision: current.revision,
    });
    expect(failed).toEqual({
      status: "failed",
      actualRevision: current.revision,
      diagnostics: [
        {
          code: "TEST_FLUSH_FAILURE",
          message: "injected failure",
        },
      ],
    });
    expect(await authority.read()).toEqual(current);

    if (foreign.status === "conflict") {
      (foreign.actualRevision as { value: string }).value = "mutated-conflict";
    }
    if (unchanged.status === "unchanged") {
      (unchanged.revision as { value: string }).value = "mutated-unchanged";
    }
    if (failed.status === "failed") {
      (failed.actualRevision as { value: string }).value = "mutated-failed";
    }
    expect(await authority.read()).toEqual(current);

    const retried = await authority.compareAndSwap({
      expectedRevision: current.revision,
      snapshot: candidateFrom(current, "retried"),
    });
    expect(retried.status).toBe("applied");
    if (retried.status !== "applied") return;
    expect(retried.receipt.previousRevision).toEqual(current.revision);
    expect(retried.receipt.revision.value).toBe("revision:2");
    expect((await authority.read()).snapshot.metadata.state).toBe("retried");
  });
});
