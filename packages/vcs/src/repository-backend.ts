import type { Awaitable } from "xnl-vfs";
import type { ObjectId } from "./hash";
import type { ObjectStore } from "./object-store";
import type { ContentStore } from "./content-store";

export type HeadState =
  | { type: "branch"; name: string }
  | { type: "detached"; commitId: ObjectId };

/** Persisted working-tree + staging state. */
export interface WorkspaceState {
  worktreeJson: string;
  stagedJson: string;
}

export interface PersistedCommitInfo {
  branchName: string;
  oldCommitId: ObjectId | null;
  newCommitId: ObjectId;
  author: string;
  message: string;
  timestamp: string;
}

export interface RepositoryBackend {
  readonly objectStore: ObjectStore;
  readonly contentStore: ContentStore;

  init(defaultBranch: string): void;

  writeHead(head: HeadState): void;
  readHead(): HeadState | null;

  readRef(refName: string): ObjectId | null;
  writeRef(refName: string, target: ObjectId | null): void;

  appendReflog(name: string, entry: { old: ObjectId | null; next: ObjectId | null; author: string; message: string; timestamp: string }): void;

  updateBranchHead(info: PersistedCommitInfo): void;

  /** Persist working-tree + staging snapshots. Optional per backend. */
  writeWorkspaceState?(state: WorkspaceState): void;
  readWorkspaceState?(): WorkspaceState | null;

  /** Flush all backend-owned repository ports to durable storage. */
  flush?(): Awaitable<void>;

  checkIntegrity(): { brokenRefs: string[]; warnings: string[] };
}
