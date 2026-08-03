import {
  dryRunMutations,
  type DataElementNode,
  type XnlMutationBatch,
  type XnlMutationBatchOptions,
  type XnlMutationDiagnostic,
} from "xnl-core";
import {
  DEFAULT_XNL_VFS_DB_NAME,
  DEFAULT_XNL_VFS_DB_VERSION,
  openXnlVfsDatabase,
  requestToPromise,
  REVISIONED_VFS_AUTHORITY_STORE,
  transactionDone,
} from "./indexeddb-schema";

export type Awaitable<T> = T | PromiseLike<T>;

export interface RevisionedPersistenceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * An opaque equality token scoped to one persistence authority.
 *
 * Consumers must compare both fields for equality and must not parse, sort, or
 * substitute a VCS identity for `value`.
 */
export interface VfsRevision {
  readonly authorityId: string;
  readonly value: string;
}

export interface RevisionedVfsSnapshot {
  readonly revision: VfsRevision;
  readonly snapshot: DataElementNode;
}

export interface RevisionedVfsFlushInput {
  readonly expectedRevision: VfsRevision;
  readonly snapshot: DataElementNode;
}

export type RevisionedVfsDurability = "memory" | "workspace";

/**
 * Evidence for an accepted live-snapshot write. VCS checkpoint identity is a
 * separate receipt owned by xnl-vcs.
 */
export interface RevisionedVfsReceipt {
  readonly previousRevision: VfsRevision;
  readonly revision: VfsRevision;
  readonly persistedAt: string;
  readonly durability: RevisionedVfsDurability;
}

export type RevisionedVfsCompareAndSwapResult =
  | {
      readonly status: "applied";
      readonly receipt: RevisionedVfsReceipt;
    }
  | {
      readonly status: "unchanged";
      readonly revision: VfsRevision;
    }
  | {
      readonly status: "conflict";
      readonly actualRevision: VfsRevision;
    }
  | {
      readonly status: "failed";
      readonly actualRevision: VfsRevision;
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
    };

/**
 * Owns revision scope, freshness validation, semantic no-op detection, and
 * persistence at one CAS linearization point.
 *
 * A foreign or stale expected revision is a conflict, including for a semantic
 * no-op. `unchanged` is valid only for a current revision and a completely
 * equal snapshot. Conflict and failure must leave snapshot and revision
 * unchanged.
 */
export interface RevisionedVfsAuthority {
  read(): Awaitable<RevisionedVfsSnapshot>;
  compareAndSwap(
    input: RevisionedVfsFlushInput,
  ): Awaitable<RevisionedVfsCompareAndSwapResult>;
}

export interface MemoryRevisionedVfsAuthorityOptions {
  readonly authorityId: string;
  readonly clock?: () => string;
  readonly revisionFactory?: (sequence: number) => string;
}

function defaultClock(): string {
  return new Date().toISOString();
}

function defaultRevisionFactory(sequence: number): string {
  return `revision:${sequence}`;
}

function cloneRevision(revision: VfsRevision): VfsRevision {
  return {
    authorityId: revision.authorityId,
    value: revision.value,
  };
}

function cloneSnapshot(snapshot: DataElementNode): DataElementNode {
  return structuredClone(snapshot);
}

function cloneRevisionedSnapshot(
  snapshot: RevisionedVfsSnapshot,
): RevisionedVfsSnapshot {
  return {
    revision: cloneRevision(snapshot.revision),
    snapshot: cloneSnapshot(snapshot.snapshot),
  };
}

function clonePersistenceDiagnostic(
  diagnostic: RevisionedPersistenceDiagnostic,
): RevisionedPersistenceDiagnostic {
  const clone: {
    code: string;
    message: string;
    cause?: unknown;
  } = {
    code: diagnostic.code,
    message: diagnostic.message,
  };
  if (Object.prototype.hasOwnProperty.call(diagnostic, "cause")) {
    clone.cause = diagnostic.cause;
  }
  return clone;
}

function cloneMutationDiagnostic(
  diagnostic: XnlMutationDiagnostic,
): XnlMutationDiagnostic {
  return structuredClone(diagnostic);
}

function cloneReceipt(receipt: RevisionedVfsReceipt): RevisionedVfsReceipt {
  return {
    previousRevision: cloneRevision(receipt.previousRevision),
    revision: cloneRevision(receipt.revision),
    persistedAt: receipt.persistedAt,
    durability: receipt.durability,
  };
}

function revisionsEqual(left: VfsRevision, right: VfsRevision): boolean {
  return left.authorityId === right.authorityId && left.value === right.value;
}

/**
 * Deterministic in-memory reference authority.
 *
 * Inputs are cloned when submitted, before they enter the serialized CAS
 * chain. The chain is the explicit linearization mechanism: every operation
 * checks freshness, detects a complete-AST no-op, consumes any pending replace
 * failure, and commits (or declines to commit) without interleaving with
 * another CAS operation.
 */
export class MemoryRevisionedVfsAuthority implements RevisionedVfsAuthority {
  private readonly authorityId: string;
  private readonly clock: () => string;
  private readonly revisionFactory: (sequence: number) => string;
  private readonly issuedRevisionValues = new Set<string>();
  private currentSnapshot: DataElementNode;
  private currentRevision: VfsRevision;
  private sequence = 0;
  private pendingFlushFailure:
    | RevisionedPersistenceDiagnostic
    | undefined;
  private casTail: Promise<void> = Promise.resolve();

  constructor(
    initialSnapshot: DataElementNode,
    options: MemoryRevisionedVfsAuthorityOptions,
  ) {
    this.authorityId = options.authorityId;
    this.clock = options.clock ?? defaultClock;
    this.revisionFactory = options.revisionFactory ?? defaultRevisionFactory;
    this.currentSnapshot = cloneSnapshot(initialSnapshot);
    this.currentRevision = {
      authorityId: this.authorityId,
      value: this.revisionFactory(this.sequence),
    };
    this.issuedRevisionValues.add(this.currentRevision.value);
  }

  read(): RevisionedVfsSnapshot {
    return {
      revision: cloneRevision(this.currentRevision),
      snapshot: cloneSnapshot(this.currentSnapshot),
    };
  }

  failNextFlush(diagnostic: RevisionedPersistenceDiagnostic): void {
    this.pendingFlushFailure = clonePersistenceDiagnostic(diagnostic);
  }

  compareAndSwap(
    input: RevisionedVfsFlushInput,
  ): Promise<RevisionedVfsCompareAndSwapResult> {
    const submission: RevisionedVfsFlushInput = {
      expectedRevision: cloneRevision(input.expectedRevision),
      snapshot: cloneSnapshot(input.snapshot),
    };
    const result = this.casTail.then(() => this.linearize(submission));
    this.casTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private linearize(
    input: RevisionedVfsFlushInput,
  ): RevisionedVfsCompareAndSwapResult {
    if (!revisionsEqual(input.expectedRevision, this.currentRevision)) {
      return {
        status: "conflict",
        actualRevision: cloneRevision(this.currentRevision),
      };
    }

    if (
      areXnlSnapshotsStructurallyEqual(
        input.snapshot,
        this.currentSnapshot,
      )
    ) {
      return {
        status: "unchanged",
        revision: cloneRevision(this.currentRevision),
      };
    }

    if (this.pendingFlushFailure) {
      const diagnostic = this.pendingFlushFailure;
      this.pendingFlushFailure = undefined;
      return {
        status: "failed",
        actualRevision: cloneRevision(this.currentRevision),
        diagnostics: [clonePersistenceDiagnostic(diagnostic)],
      };
    }

    const nextSequence = this.sequence + 1;
    let nextRevision: VfsRevision;
    let persistedAt: string;
    try {
      const nextRevisionValue = this.revisionFactory(nextSequence);
      if (this.issuedRevisionValues.has(nextRevisionValue)) {
        throw new Error(
          "revisionFactory must not reuse a revision token value already issued by this authority",
        );
      }
      nextRevision = {
        authorityId: this.authorityId,
        value: nextRevisionValue,
      };
      persistedAt = this.clock();
    } catch (cause) {
      return {
        status: "failed",
        actualRevision: cloneRevision(this.currentRevision),
        diagnostics: [
          {
            code: "MEMORY_REVISIONED_VFS_FLUSH_FAILED",
            message: "Memory revisioned VFS flush failed",
            cause,
          },
        ],
      };
    }

    const previousRevision = this.currentRevision;
    this.currentSnapshot = input.snapshot;
    this.currentRevision = nextRevision;
    this.sequence = nextSequence;
    this.issuedRevisionValues.add(nextRevision.value);

    return {
      status: "applied",
      receipt: {
        previousRevision: cloneRevision(previousRevision),
        revision: cloneRevision(nextRevision),
        persistedAt,
        durability: "memory",
      },
    };
  }
}

export interface IndexedDbRevisionedVfsAuthorityOptions {
  readonly authorityId: string;
  readonly initialSnapshot: DataElementNode;
  readonly dbName?: string;
  readonly dbVersion?: number;
  readonly indexedDbFactory?: IDBFactory;
  readonly clock?: () => string;
  readonly revisionFactory?: (sequence: number) => string;
}

interface IndexedDbRevisionedVfsRecord {
  readonly authorityId: string;
  readonly sequence: number;
  readonly revisionValue: string;
  readonly issuedRevisionValues: readonly string[];
  readonly snapshot: DataElementNode;
}

function revisionFromRecord(
  record: IndexedDbRevisionedVfsRecord,
): VfsRevision {
  return {
    authorityId: record.authorityId,
    value: record.revisionValue,
  };
}

function indexedDbUnavailableError(): Error {
  return new Error(
    "IndexedDB is unavailable in this runtime. Pass indexedDbFactory to IndexedDbRevisionedVfsAuthorityOptions in non-browser environments.",
  );
}

/**
 * Browser-workspace authority whose record is the CAS linearization point.
 * Independent instances remain consistent because IndexedDB serializes
 * readwrite transactions that target the same object store.
 */
export class IndexedDbRevisionedVfsAuthority
  implements RevisionedVfsAuthority
{
  private readonly authorityId: string;
  private readonly dbName: string;
  private readonly dbVersion: number;
  private readonly indexedDbFactory: IDBFactory;
  private readonly clock: () => string;
  private readonly revisionFactory: (sequence: number) => string;

  private constructor(options: IndexedDbRevisionedVfsAuthorityOptions) {
    const indexedDbFactory =
      options.indexedDbFactory ??
      (typeof globalThis !== "undefined" ? globalThis.indexedDB : undefined);
    if (!indexedDbFactory) {
      throw indexedDbUnavailableError();
    }
    this.authorityId = options.authorityId;
    this.dbName = options.dbName ?? DEFAULT_XNL_VFS_DB_NAME;
    this.dbVersion = options.dbVersion ?? DEFAULT_XNL_VFS_DB_VERSION;
    this.indexedDbFactory = indexedDbFactory;
    this.clock = options.clock ?? defaultClock;
    this.revisionFactory = options.revisionFactory ?? defaultRevisionFactory;
  }

  static async open(
    options: IndexedDbRevisionedVfsAuthorityOptions,
  ): Promise<IndexedDbRevisionedVfsAuthority> {
    if (!options.authorityId) {
      throw new Error("IndexedDB revisioned VFS authorityId must not be blank");
    }
    const authority = new IndexedDbRevisionedVfsAuthority(options);
    await authority.seedIfAbsent(cloneSnapshot(options.initialSnapshot));
    return authority;
  }

  async read(): Promise<RevisionedVfsSnapshot> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(
        REVISIONED_VFS_AUTHORITY_STORE,
        "readonly",
      );
      const completed = transactionDone(transaction);
      const record = await requestToPromise<
        IndexedDbRevisionedVfsRecord | undefined
      >(
        transaction
          .objectStore(REVISIONED_VFS_AUTHORITY_STORE)
          .get(this.authorityId),
      );
      await completed;
      if (!record) {
        throw new Error(
          `IndexedDB revisioned VFS authority record is missing: ${this.authorityId}`,
        );
      }
      return {
        revision: revisionFromRecord(record),
        snapshot: cloneSnapshot(record.snapshot),
      };
    } finally {
      database.close();
    }
  }

  async compareAndSwap(
    input: RevisionedVfsFlushInput,
  ): Promise<RevisionedVfsCompareAndSwapResult> {
    let submittedSnapshot: DataElementNode;
    let submittedRevision: VfsRevision;
    try {
      submittedSnapshot = cloneSnapshot(input.snapshot);
      submittedRevision = cloneRevision(input.expectedRevision);
    } catch (cause) {
      const current = await this.read();
      return this.failedResult(current.revision, cause);
    }

    const database = await this.openDatabase();
    let actualRevision: VfsRevision | undefined;
    try {
      const transaction = database.transaction(
        REVISIONED_VFS_AUTHORITY_STORE,
        "readwrite",
      );
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(REVISIONED_VFS_AUTHORITY_STORE);
      const record = await requestToPromise<
        IndexedDbRevisionedVfsRecord | undefined
      >(store.get(this.authorityId));
      if (!record) {
        throw new Error(
          `IndexedDB revisioned VFS authority record is missing: ${this.authorityId}`,
        );
      }
      actualRevision = revisionFromRecord(record);

      if (!revisionsEqual(submittedRevision, actualRevision)) {
        await completed;
        return {
          status: "conflict",
          actualRevision: cloneRevision(actualRevision),
        };
      }

      if (
        areXnlSnapshotsStructurallyEqual(submittedSnapshot, record.snapshot)
      ) {
        await completed;
        return {
          status: "unchanged",
          revision: cloneRevision(actualRevision),
        };
      }

      const nextSequence = record.sequence + 1;
      const nextRevisionValue = this.revisionFactory(nextSequence);
      if (record.issuedRevisionValues.includes(nextRevisionValue)) {
        throw new Error(
          "revisionFactory must not reuse a revision token value already issued by this authority",
        );
      }
      const persistedAt = this.clock();
      const nextRecord: IndexedDbRevisionedVfsRecord = {
        authorityId: this.authorityId,
        sequence: nextSequence,
        revisionValue: nextRevisionValue,
        issuedRevisionValues: [
          ...record.issuedRevisionValues,
          nextRevisionValue,
        ],
        snapshot: submittedSnapshot,
      };
      store.put(nextRecord);
      await completed;

      const nextRevision = revisionFromRecord(nextRecord);
      return {
        status: "applied",
        receipt: {
          previousRevision: cloneRevision(actualRevision),
          revision: cloneRevision(nextRevision),
          persistedAt,
          durability: "workspace",
        },
      };
    } catch (cause) {
      if (!actualRevision) {
        throw cause;
      }
      return this.failedResult(actualRevision, cause);
    } finally {
      database.close();
    }
  }

  private async seedIfAbsent(initialSnapshot: DataElementNode): Promise<void> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(
        REVISIONED_VFS_AUTHORITY_STORE,
        "readwrite",
      );
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(REVISIONED_VFS_AUTHORITY_STORE);
      const existing = await requestToPromise<
        IndexedDbRevisionedVfsRecord | undefined
      >(store.get(this.authorityId));
      if (!existing) {
        const revisionValue = this.revisionFactory(0);
        store.add({
          authorityId: this.authorityId,
          sequence: 0,
          revisionValue,
          issuedRevisionValues: [revisionValue],
          snapshot: initialSnapshot,
        } satisfies IndexedDbRevisionedVfsRecord);
      }
      await completed;
    } finally {
      database.close();
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    return openXnlVfsDatabase(
      this.indexedDbFactory,
      this.dbName,
      this.dbVersion,
    );
  }

  private failedResult(
    actualRevision: VfsRevision,
    cause: unknown,
  ): RevisionedVfsCompareAndSwapResult {
    return {
      status: "failed",
      actualRevision: cloneRevision(actualRevision),
      diagnostics: [
        {
          code: "INDEXEDDB_REVISIONED_VFS_FLUSH_FAILED",
          message: "IndexedDB revisioned VFS flush failed",
          cause,
        },
      ],
    };
  }
}

export function createIndexedDbRevisionedVfsAuthority(
  options: IndexedDbRevisionedVfsAuthorityOptions,
): Promise<IndexedDbRevisionedVfsAuthority> {
  return IndexedDbRevisionedVfsAuthority.open(options);
}

export interface ApplyRevisionedVfsMutationsInput {
  readonly base: RevisionedVfsSnapshot;
  readonly mutations: XnlMutationBatch;
  /**
   * `metadataIdMode` belongs to the coordinator and must be forced to
   * `"identity"` by its runtime implementation.
   */
  readonly mutationOptions?: Omit<
    XnlMutationBatchOptions,
    "metadataIdMode"
  >;
}

export type ApplyRevisionedVfsMutationsResult =
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
  | {
      readonly status: "conflict";
      readonly actualRevision: VfsRevision;
    }
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

export type ApplyRevisionedVfsMutations = (
  authority: RevisionedVfsAuthority,
  input: ApplyRevisionedVfsMutationsInput,
) => Awaitable<ApplyRevisionedVfsMutationsResult>;

export const applyRevisionedVfsMutations: ApplyRevisionedVfsMutations = async (
  authority,
  input,
) => {
  const base = cloneRevisionedSnapshot(input.base);
  const dryRunResult = dryRunMutations(base.snapshot, input.mutations, {
    ...input.mutationOptions,
    metadataIdMode: "identity",
  });

  if (dryRunResult.status === "rejected") {
    return {
      status: "rejected",
      base: cloneRevisionedSnapshot(base),
      diagnostics: dryRunResult.diagnostics.map(cloneMutationDiagnostic),
    };
  }

  const candidate = dryRunResult.value as DataElementNode;
  const persistenceResult = await authority.compareAndSwap({
    expectedRevision: cloneRevision(base.revision),
    snapshot: cloneSnapshot(candidate),
  });

  switch (persistenceResult.status) {
    case "applied":
      return {
        status: "applied",
        snapshot: cloneSnapshot(candidate),
        receipt: cloneReceipt(persistenceResult.receipt),
      };
    case "unchanged":
      return {
        status: "unchanged",
        snapshot: cloneSnapshot(candidate),
        revision: cloneRevision(persistenceResult.revision),
      };
    case "conflict":
      return {
        status: "conflict",
        actualRevision: cloneRevision(persistenceResult.actualRevision),
      };
    case "failed":
      return {
        status: "failed",
        actualRevision: cloneRevision(persistenceResult.actualRevision),
        diagnostics: persistenceResult.diagnostics.map(
          clonePersistenceDiagnostic,
        ),
      };
  }
};

type ComparisonState = "comparing" | boolean;
type ComparisonMemo = WeakMap<object, WeakMap<object, ComparisonState>>;

function compareStructuralValues(
  left: unknown,
  right: unknown,
  memo: ComparisonMemo,
): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);
  if (leftIsArray !== rightIsArray) {
    return false;
  }
  if (leftIsArray && rightIsArray && left.length !== right.length) {
    return false;
  }

  let comparisons = memo.get(left);
  const knownState = comparisons?.get(right);
  if (knownState !== undefined) {
    return knownState === "comparing" ? true : knownState;
  }
  if (!comparisons) {
    comparisons = new WeakMap<object, ComparisonState>();
    memo.set(left, comparisons);
  }
  comparisons.set(right, "comparing");

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  const equal =
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        compareStructuralValues(leftRecord[key], rightRecord[key], memo),
    );

  comparisons.set(right, equal);
  return equal;
}

/**
 * Compares complete XNL AST structure, including explicit and fallback identity
 * fields. Object key insertion order is ignored; array indices, body order, and
 * Extend order remain significant. Own optional-field presence is significant.
 */
export function areXnlSnapshotsStructurallyEqual(
  left: DataElementNode,
  right: DataElementNode,
): boolean {
  return compareStructuralValues(left, right, new WeakMap());
}
