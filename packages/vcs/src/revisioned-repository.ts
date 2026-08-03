import type { DataElementNode } from "xnl-core";
import {
  applyRevisionedVfsMutations,
  areXnlSnapshotsStructurallyEqual,
  type ApplyRevisionedVfsMutationsInput,
  type ApplyRevisionedVfsMutationsResult,
  type RevisionedPersistenceDiagnostic,
  type RevisionedVfsAuthority,
  type RevisionedVfsSnapshot,
  type VfsRevision,
} from "xnl-vfs";
import type { ObjectId } from "./hash";
import type {
  CommitSnapshotHistoryState,
  Repository,
  RepositoryCommitSnapshotResult,
} from "./repository";
import { readLosslessTreeSnapshot } from "./tree-converter";
import type { CommitObject } from "./types";

export interface RevisionedRepositoryAdapterOptions {
  readonly repository: Repository;
  readonly authority: RevisionedVfsAuthority;
}

export type RevisionedRepositoryOpenResult = RevisionedVfsSnapshot;
export type RevisionedRepositoryApplyInput = ApplyRevisionedVfsMutationsInput;
export type RevisionedRepositoryApplyResult = ApplyRevisionedVfsMutationsResult;

export interface RepositoryCheckpointOptions {
  readonly author?: string;
}

export interface RepositoryCheckpointReceipt {
  readonly liveRevision: VfsRevision;
  readonly commitId: ObjectId;
  readonly durability: "memory-accepted" | "backend-flushed";
}

export type RepositoryCheckpointResult =
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
      readonly phase:
        | "commit"
        | "post-commit-verify"
        | "flush"
        | "restore";
      readonly liveRevision: VfsRevision;
      readonly headBefore: ObjectId | null;
      readonly observedHead: ObjectId | null;
      readonly candidateCommitId?: ObjectId;
      readonly historyState: CommitSnapshotHistoryState;
      readonly worktreeState: "restored" | "unknown";
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
    };

function cloneRevision(revision: VfsRevision): VfsRevision {
  return {
    authorityId: revision.authorityId,
    value: revision.value,
  };
}

function revisionsEqual(left: VfsRevision, right: VfsRevision): boolean {
  return (
    left.authorityId === right.authorityId &&
    left.value === right.value
  );
}

function sanitizeCause(error: unknown): unknown {
  if (error instanceof Error) {
    const cause: { name: string; message: string; code?: string } = {
      name: error.name,
      message: error.message,
    };
    const code = Reflect.get(error, "code");
    if (typeof code === "string") {
      cause.code = code;
    }
    return cause;
  }
  return String(error);
}

function diagnostic(
  code: string,
  message: string,
  cause?: unknown,
): readonly RevisionedPersistenceDiagnostic[] {
  return Object.freeze([
    Object.freeze({
      code,
      message,
      ...(cause === undefined ? {} : { cause: sanitizeCause(cause) }),
    }),
  ]);
}

function readCandidateCommit(
  repository: Repository,
  commitId: ObjectId,
): CommitObject {
  const object = repository.store.get(commitId);
  if (!object) {
    throw new Error(`Checkpoint commit object not found: ${commitId}`);
  }
  if (object.type !== "commit") {
    throw new Error(
      `Expected checkpoint commit object, received ${object.type}`,
    );
  }
  return object;
}

/**
 * Projects one revisioned VFS authority into a Repository public worktree.
 *
 * The authority remains the sole live-snapshot authority. Repository history is
 * intentionally outside open/apply and is handled by the separate checkpoint
 * operation.
 */
export class RevisionedRepositoryAdapter {
  private readonly repository: Repository;
  private readonly authority: RevisionedVfsAuthority;

  constructor(options: RevisionedRepositoryAdapterOptions) {
    this.repository = options.repository;
    this.authority = options.authority;
  }

  async open(): Promise<RevisionedRepositoryOpenResult> {
    const opened = structuredClone(await this.authority.read());
    this.repository.vfs.loadSnapshot(opened.snapshot);
    return structuredClone(opened);
  }

  async apply(
    input: RevisionedRepositoryApplyInput,
  ): Promise<RevisionedRepositoryApplyResult> {
    const result = await applyRevisionedVfsMutations(this.authority, input);
    if (result.status === "applied") {
      this.repository.vfs.loadSnapshot(result.snapshot);
    }
    return result;
  }

  async checkpoint(
    expectedLiveRevision: VfsRevision,
    message: string,
    options: RepositoryCheckpointOptions = {},
  ): Promise<RepositoryCheckpointResult> {
    const headBeforeRead = this.repository.getHeadCommitId();
    let current: RevisionedVfsSnapshot;

    try {
      current = structuredClone(await this.authority.read());
    } catch (error) {
      return {
        status: "failed",
        phase: "read",
        historyState: "not-started",
        diagnostics: diagnostic(
          "revisioned-repository-checkpoint-read-failed",
          "Unable to read the revisioned VFS authority for checkpoint",
          error,
        ),
        headBefore: headBeforeRead,
        observedHead: this.repository.getHeadCommitId(),
        worktreeState: "restored",
      };
    }

    if (!revisionsEqual(expectedLiveRevision, current.revision)) {
      return {
        status: "conflict",
        expectedRevision: cloneRevision(expectedLiveRevision),
        actualRevision: cloneRevision(current.revision),
      };
    }

    const commitOptions =
      options.author === undefined ? {} : { author: options.author };
    const commitResult = this.repository.commitSnapshot(
      structuredClone(current.snapshot),
      message,
      commitOptions,
    );
    const liveRevision = cloneRevision(current.revision);

    if (commitResult.status === "failed") {
      return {
        status: "failed",
        phase: "pre-commit",
        headBefore: commitResult.headBefore,
        observedHead: commitResult.observedHead,
        historyState: "not-started",
        worktreeState: "restored",
        diagnostics: commitResult.diagnostics,
      };
    }

    if (commitResult.status === "indeterminate") {
      return this.mapIndeterminateCommitResult(
        liveRevision,
        commitResult,
      );
    }

    let committedSnapshot: DataElementNode;
    try {
      const commit = readCandidateCommit(
        this.repository,
        commitResult.commitId,
      );
      committedSnapshot = readLosslessTreeSnapshot(
        commit.tree,
        this.repository.store,
        this.repository.contentStore,
      );
    } catch (error) {
      return {
        status: "indeterminate",
        phase: "post-commit-verify",
        liveRevision,
        headBefore: commitResult.headBefore,
        observedHead: commitResult.observedHead,
        candidateCommitId: commitResult.commitId,
        historyState: "accepted",
        worktreeState: "restored",
        diagnostics: diagnostic(
          "revisioned-repository-checkpoint-verify-read-failed",
          "Unable to read the committed checkpoint tree",
          error,
        ),
      };
    }

    if (
      !areXnlSnapshotsStructurallyEqual(
        current.snapshot,
        committedSnapshot,
      )
    ) {
      return {
        status: "indeterminate",
        phase: "post-commit-verify",
        liveRevision,
        headBefore: commitResult.headBefore,
        observedHead: commitResult.observedHead,
        candidateCommitId: commitResult.commitId,
        historyState: "accepted",
        worktreeState: "restored",
        diagnostics: diagnostic(
          "revisioned-repository-checkpoint-verify-mismatch",
          "Committed checkpoint tree does not structurally equal the authority snapshot",
        ),
      };
    }

    let backendFlushed: boolean;
    try {
      backendFlushed = await this.repository.flushBoundBackend();
    } catch (error) {
      return {
        status: "indeterminate",
        phase: "flush",
        liveRevision,
        headBefore: commitResult.headBefore,
        observedHead: this.repository.getHeadCommitId(),
        candidateCommitId: commitResult.commitId,
        historyState: "accepted",
        worktreeState: "restored",
        diagnostics: diagnostic(
          "revisioned-repository-checkpoint-flush-failed",
          "Repository backend flush failed after checkpoint commit",
          error,
        ),
      };
    }

    return {
      status: "checkpointed",
      receipt: {
        liveRevision,
        commitId: commitResult.commitId,
        durability: backendFlushed
          ? "backend-flushed"
          : "memory-accepted",
      },
    };
  }

  private mapIndeterminateCommitResult(
    liveRevision: VfsRevision,
    result: Extract<
      RepositoryCommitSnapshotResult,
      { readonly status: "indeterminate" }
    >,
  ): RepositoryCheckpointResult {
    return {
      status: "indeterminate",
      phase: result.phase,
      liveRevision,
      headBefore: result.headBefore,
      observedHead: result.observedHead,
      ...(result.candidateCommitId === undefined
        ? {}
        : { candidateCommitId: result.candidateCommitId }),
      historyState: result.historyState,
      worktreeState: result.worktreeState,
      diagnostics: result.diagnostics,
    };
  }
}
