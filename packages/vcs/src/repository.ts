import type { DataElementNode, ExtendBody } from "xnl-core";
import type { RevisionedPersistenceDiagnostic } from "xnl-vfs";
import {
  VFS_PROJECT,
  VFS_ROOT,
  VirtualFileSystem,
  createFileNode,
  createFolderNode,
  diffVfsSnapshots,
  folderChildren,
  isFile,
  isFolder,
  normalizeVfsPath,
  readName,
} from "xnl-vfs";
import type { VfsMutation, VfsMutationRuntimeOptions } from "xnl-vfs";
import { binaryFileHandler, textFileHandler, xnlFileHandler } from "xnl-vfs";
import { VcsError, assertVcs } from "./errors";
import type { ObjectId } from "./hash";
import { assertObject, MemoryObjectStore, type ObjectStore } from "./object-store";
import { MemoryContentStore, type ContentStore } from "./content-store";
import type { RepositoryBackend, WorkspaceState } from "./repository-backend";
import { buildLosslessTree, buildTree, checkoutTree, collectFolders, flattenSnapshot, readTreeSnapshot } from "./tree-converter";
import type { CommitObject, FileSnapshot, MergeConflict, MergeResolution, TagObject } from "./types";

export interface StatusEntry {
  path: string;
  kind: "file" | "folder";
  change: "added" | "modified" | "deleted";
}

export const WORKTREE_REF = "WORKTREE";

export interface RepositoryDiffResult {
  entries: StatusEntry[];
  mutations: VfsMutation[];
  fromSnapshot: DataElementNode;
  toSnapshot: DataElementNode;
}

export interface RepositoryStatus {
  added: string[];
  modified: string[];
  deleted: string[];
  entries: StatusEntry[];
  clean: boolean;
}

export interface LogEntry {
  id: ObjectId;
  message: string;
  author: string;
  timestamp: string;
  parents: ObjectId[];
}

export interface MergeOutcome {
  kind: "already_up_to_date" | "fast_forward" | "merged" | "conflict";
  commitId?: ObjectId;
  conflicts?: MergeConflict[];
}

export type CommitSnapshotHistoryState = "not-started" | "possibly-accepted" | "accepted";

export interface RepositoryCommitSnapshotOptions {
  readonly author?: string;
}

export type RepositoryCommitSnapshotResult =
  | {
      readonly status: "committed";
      readonly commitId: ObjectId;
      readonly headBefore: ObjectId | null;
      readonly observedHead: ObjectId | null;
      readonly historyState: "accepted";
      readonly worktreeState: "restored";
    }
  | {
      readonly status: "failed";
      readonly phase: "stage" | "pre-commit";
      readonly headBefore: ObjectId | null;
      readonly observedHead: ObjectId | null;
      readonly historyState: "not-started";
      readonly worktreeState: "restored";
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
    }
  | {
      readonly status: "indeterminate";
      readonly phase: "commit" | "restore";
      readonly headBefore: ObjectId | null;
      readonly observedHead: ObjectId | null;
      readonly candidateCommitId?: ObjectId;
      readonly historyState: CommitSnapshotHistoryState;
      readonly worktreeState: "restored" | "unknown";
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
    };

type HeadState =
  | { type: "branch"; name: string }
  | { type: "detached"; commitId: ObjectId };

type RefMap = Map<string, ObjectId | null>;

type WorkspaceBackup =
  | { readonly kind: "unavailable" }
  | { readonly kind: "captured"; readonly state: WorkspaceState | null };

type PendingCommitSnapshotOutcome =
  | RepositoryCommitSnapshotResult
  | {
      readonly status: "failed";
      readonly phase: "stage" | "pre-commit";
      readonly headBefore: ObjectId | null;
      readonly observedHead: ObjectId | null;
      readonly historyState: "not-started";
      readonly worktreeState: "unknown";
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
    };

function cloneSnapshot(snapshot: DataElementNode): DataElementNode {
  return structuredClone(snapshot);
}

function cloneWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    worktreeJson: state.worktreeJson,
    stagedJson: state.stagedJson,
  };
}

function sanitizeCause(error: unknown): unknown {
  if (error instanceof Error) {
    const out: { name: string; message: string; code?: string } = {
      name: error.name,
      message: error.message,
    };
    const code = Reflect.get(error, "code");
    if (typeof code === "string") {
      out.code = code;
    }
    return out;
  }
  return String(error);
}

function diagnosticFromError(error: unknown, fallbackCode: string): RevisionedPersistenceDiagnostic {
  const errorCode = typeof error === "object" && error !== null && typeof Reflect.get(error, "code") === "string"
    ? (Reflect.get(error, "code") as string)
    : fallbackCode;
  const message = error instanceof Error ? error.message : String(error);
  return Object.freeze({
    code: errorCode,
    message,
    cause: sanitizeCause(error),
  });
}

function freezeDiagnostics(
  diagnostics: readonly RevisionedPersistenceDiagnostic[],
): readonly RevisionedPersistenceDiagnostic[] {
  return Object.freeze(
    diagnostics.map((diagnostic) =>
      Object.freeze({
        code: diagnostic.code,
        message: diagnostic.message,
        ...(Object.prototype.hasOwnProperty.call(diagnostic, "cause")
          ? { cause: sanitizeCause(diagnostic.cause) }
          : {}),
      }),
    ),
  );
}

function collectNodeKinds(snapshot: DataElementNode): Map<string, "file" | "folder"> {
  const out = new Map<string, "file" | "folder">();
  const walk = (node: DataElementNode, path: string): void => {
    if (isFolder(node)) {
      out.set(path, "folder");
      for (const child of folderChildren(node)) {
        walk(child, normalizeVfsPath(`${path}/${readName(child)}`));
      }
      return;
    }
    if (isFile(node)) {
      out.set(path, "file");
    }
  };
  walk(snapshot, VFS_ROOT);
  return out;
}

function preferChange(current: "added" | "modified" | "deleted", next: "added" | "modified" | "deleted"): "added" | "modified" | "deleted" {
  if (current === next) return current;
  if (current === "added" || current === "deleted") return current;
  if (next === "added" || next === "deleted") return next;
  return "modified";
}

function mutationPath(mutation: VfsMutation): string {
  switch (mutation.type) {
    case "FILE_DELETE":
    case "FOLDER_DELETE":
      return mutation.path;
    case "MOVE":
    case "RENAME":
      return mutation.targetPath ?? mutation.path;
    default:
      return mutation.path;
  }
}

function mutationChange(mutation: VfsMutation): "added" | "modified" | "deleted" {
  switch (mutation.type) {
    case "FILE_CREATE":
    case "FOLDER_CREATE":
      return "added";
    case "FILE_DELETE":
    case "FOLDER_DELETE":
      return "deleted";
    default:
      return "modified";
  }
}

function mutationKind(
  mutation: VfsMutation,
  path: string,
  fromKinds: Map<string, "file" | "folder">,
  toKinds: Map<string, "file" | "folder">
): "file" | "folder" {
  switch (mutation.type) {
    case "FILE_CREATE":
    case "FILE_DELETE":
    case "CONTENT_UPDATE":
      return "file";
    case "FOLDER_CREATE":
    case "FOLDER_DELETE":
      return "folder";
    default:
      return toKinds.get(path) ?? fromKinds.get(path) ?? "file";
  }
}

function entriesFromMutations(
  mutations: VfsMutation[],
  fromKinds: Map<string, "file" | "folder">,
  toKinds: Map<string, "file" | "folder">
): StatusEntry[] {
  const out = new Map<string, StatusEntry>();
  for (const mutation of mutations) {
    const path = mutationPath(mutation);
    const change = mutationChange(mutation);
    const kind = mutationKind(mutation, path, fromKinds, toKinds);
    const existing = out.get(path);
    if (!existing) {
      out.set(path, { path, kind, change });
      continue;
    }
    existing.change = preferChange(existing.change, change);
    existing.kind = existing.kind ?? kind;
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function buildIdMap(files: FileSnapshot[]): Map<string, FileSnapshot> {
  const map = new Map<string, FileSnapshot>();
  for (const file of files) {
    map.set(file.metadataId, file);
  }
  return map;
}

function mergeText(base: string, ours: string, theirs: string): { merged: string; conflict: boolean } {
  return textFileHandler.merge(base, ours, theirs);
}

function mergeXnl(base: string, ours: string, theirs: string): { merged: string } {
  return xnlFileHandler.merge(base, ours, theirs);
}

function mergeBinary(base: string, ours: string, theirs: string): { merged?: string; conflict?: { type: "BINARY_UNMERGEABLE" } } {
  const result = binaryFileHandler.merge(base, ours, theirs);
  if (result.conflict) {
    return { conflict: { type: "BINARY_UNMERGEABLE" } };
  }
  return { merged: result.merged };
}

function buildFolderMapPreference(
  ours: Map<string, { metadataId: string; extend?: unknown }>,
  base: Map<string, { metadataId: string; extend?: unknown }>
): Map<string, { metadataId: string; extend?: unknown }> {
  const out = new Map<string, { metadataId: string; extend?: unknown }>();
  for (const [path, info] of base.entries()) {
    out.set(path, info);
  }
  for (const [path, info] of ours.entries()) {
    out.set(path, info);
  }
  return out;
}

function buildSnapshotFromFiles(
  files: FileSnapshot[],
  folderMap: Map<string, { metadataId: string; extend?: unknown }>,
  rootId?: string
): VirtualFileSystem {
  const rootInfo = folderMap.get(VFS_ROOT);
  const root = createFolderNode(VFS_PROJECT, {
    id: rootId ?? rootInfo?.metadataId,
    extend: (rootInfo?.extend as ExtendBody | undefined) ?? undefined,
  });
  root.body = [];

  const ensureFolder = (path: string): DataElementNode => {
    const normalized = normalizeVfsPath(path);
    if (normalized === VFS_ROOT) return root;

    const segments = normalized.split("/").slice(3);
    let cursor: DataElementNode = root;
    let currentPath = VFS_ROOT;
    for (const segment of segments) {
      currentPath = normalizeVfsPath(`${currentPath}/${segment}`);
      if (!isFolder(cursor)) {
        throw new VcsError("EINVAL", `Expected folder while building snapshot at ${currentPath}`);
      }
      let existing = folderChildren(cursor).find((child) => isFolder(child) && readName(child) === segment);
      if (!existing) {
        const info = folderMap.get(currentPath);
        existing = createFolderNode(segment, {
          id: info?.metadataId,
          extend: (info?.extend as ExtendBody | undefined) ?? undefined,
        });
        existing.body = [];
        cursor.body = cursor.body ?? [];
        cursor.body.push(existing);
      }
      cursor = existing;
    }
    return cursor;
  };

  for (const file of files) {
    const normalized = normalizeVfsPath(file.path);
    const parts = normalized.split("/");
    const fileName = parts[parts.length - 1] as string;
    const folderPath = parts.slice(0, -1).join("/");
    const folder = ensureFolder(folderPath);
    folder.body = folder.body ?? [];
    folder.body.push(
      createFileNode(fileName, file.content, file.fileType, {
        id: file.metadataId,
        extend: file.extend,
      })
    );
  }

  const vfs = new VirtualFileSystem(root);
  return vfs;
}

export class Repository {
  readonly vfs: VirtualFileSystem;
  readonly store: ObjectStore;
  readonly contentStore: ContentStore;

  private readonly backend?: RepositoryBackend;
  private readonly mutationRuntimeOptions?: VfsMutationRuntimeOptions;

  private readonly branches: RefMap = new Map();
  private readonly tags: RefMap = new Map();
  private head: HeadState = { type: "branch", name: "main" };

  constructor(options?: {
    vfs?: VirtualFileSystem;
    store?: ObjectStore;
    contentStore?: ContentStore;
    backend?: RepositoryBackend;
    mutationRuntimeOptions?: VfsMutationRuntimeOptions;
    state?: {
      head: HeadState;
      branches: Record<string, ObjectId | null>;
      tags: Record<string, ObjectId | null>;
    };
  }) {
    this.vfs = options?.vfs ?? new VirtualFileSystem();
    this.backend = options?.backend;
    this.store = options?.store ?? this.backend?.objectStore ?? new MemoryObjectStore();
    this.contentStore = options?.contentStore ?? this.backend?.contentStore ?? new MemoryContentStore();
    this.mutationRuntimeOptions = options?.mutationRuntimeOptions;

    if (options?.state) {
      this.branches.clear();
      this.tags.clear();

      for (const [name, target] of Object.entries(options.state.branches)) {
        this.branches.set(name, target);
      }
      for (const [name, target] of Object.entries(options.state.tags)) {
        this.tags.set(name, target);
      }
      this.head = options.state.head.type === "branch" ? { type: "branch", name: options.state.head.name } : { type: "detached", commitId: options.state.head.commitId };

      const headCommitId = this.getHeadCommitId();
      if (!headCommitId) {
        this.vfs.loadSnapshot(createFolderNode(VFS_PROJECT));
      } else {
        this.checkoutCommit(headCommitId);
      }
    } else {
      this.branches.set("main", null);
    }
  }

  init(defaultBranch = "main"): void {
    this.branches.clear();
    this.tags.clear();
    this.branches.set(defaultBranch, null);
    this.head = { type: "branch", name: defaultBranch };

    if (this.backend) {
      this.backend.init(defaultBranch);
    }
    this.persistWorkspace();
  }

  /**
   * Persist the current working-tree snapshot to the backend's workspace state.
   * xnl has no separate staging area — the whole worktree is what a commit
   * captures — so staged mirrors the worktree.
   */
  private persistWorkspace(): void {
    if (!this.backend?.writeWorkspaceState) {
      return;
    }
    const worktreeJson = JSON.stringify(this.vfs.getSnapshot());
    this.backend.writeWorkspaceState({ worktreeJson, stagedJson: worktreeJson });
  }

  /**
   * Restore the working tree from the backend's persisted workspace state, if
   * any. Returns true when a snapshot was loaded. Lets a reopened repository
   * recover an uncommitted worktree without a checkout.
   */
  loadWorkspaceState(): boolean {
    if (!this.backend?.readWorkspaceState) {
      return false;
    }
    const state = this.backend.readWorkspaceState();
    if (!state || !state.worktreeJson || state.worktreeJson === "{}") {
      return false;
    }
    try {
      const snapshot = JSON.parse(state.worktreeJson) as DataElementNode;
      this.vfs.loadSnapshot(snapshot);
      return true;
    } catch {
      throw new VcsError("EINVAL", "Malformed workspace worktree snapshot");
    }
  }

  getBranchHead(name: string): ObjectId | null {
    if (!this.branches.has(name)) {
      throw new VcsError("ENOENT", `Unknown branch: ${name}`);
    }
    return this.branches.get(name) ?? null;
  }

  listRefs(): Array<{ name: string; type: "branch" | "tag"; target: ObjectId | null }> {
    const refs: Array<{ name: string; type: "branch" | "tag"; target: ObjectId | null }> = [];
    for (const [name, target] of this.branches.entries()) {
      refs.push({ name, type: "branch", target });
    }
    for (const [name, tagId] of this.tags.entries()) {
      let target: ObjectId | null = null;
      if (tagId) {
        const tag = assertObject(this.store.get<TagObject>(tagId), tagId);
        if (tag.type === "tag") {
          target = tag.target;
        }
      }
      refs.push({ name, type: "tag", target });
    }
    refs.sort((a, b) => a.name.localeCompare(b.name));
    return refs;
  }

  getHead(): HeadState {
    return this.head.type === "branch" ? { ...this.head } : { ...this.head };
  }

  getHeadCommitId(): ObjectId | null {
    if (this.head.type === "detached") {
      return this.head.commitId;
    }
    return this.branches.get(this.head.name) ?? null;
  }

  async flushBoundBackend(): Promise<boolean> {
    const backend = this.backend;
    if (
      !backend?.flush ||
      this.store !== backend.objectStore ||
      this.contentStore !== backend.contentStore
    ) {
      return false;
    }
    await backend.flush();
    return true;
  }

  commit(message: string, options: { author?: string } = {}): ObjectId {
    if (this.head.type !== "branch") {
      throw new VcsError("EDETACHEDHEAD", "Cannot commit while HEAD is detached");
    }

    const tree = buildTree(this.vfs, this.store, this.contentStore);
    return this.commitTree(tree, message, options, { persistWorkspace: true });
  }

  commitSnapshot(
    snapshot: DataElementNode,
    message: string,
    options: RepositoryCommitSnapshotOptions = {},
  ): RepositoryCommitSnapshotResult {
    const headBefore = this.getHeadCommitId();
    let observedHead = headBefore;
    let publicWorktree: DataElementNode | undefined;
    let publicWorktreeMayNeedRestore = false;
    let workspaceBackup: WorkspaceBackup = { kind: "unavailable" };
    let candidateCommitId: ObjectId | undefined;
    let commitAttempted = false;
    let historyAccepted = false;
    let stageCompleted = false;

    let outcome: PendingCommitSnapshotOutcome;

    try {
      publicWorktree = this.vfs.getSnapshot();
      workspaceBackup = this.captureWorkspaceState();
      const stagedSnapshot = cloneSnapshot(snapshot);
      publicWorktreeMayNeedRestore = true;
      this.vfs.loadSnapshot(stagedSnapshot);
      const tree = buildLosslessTree(stagedSnapshot, this.store, this.contentStore);
      stageCompleted = true;

      if (this.head.type !== "branch") {
        throw new VcsError("EDETACHEDHEAD", "Cannot commit while HEAD is detached");
      }

      commitAttempted = true;
      const commitId = this.commitTree(tree, message, options, {
        persistWorkspace: false,
        onCandidateCommitId: (id) => {
          candidateCommitId = id;
        },
        onHistoryAccepted: () => {
          historyAccepted = true;
        },
      });
      observedHead = this.getHeadCommitId();
      outcome = {
        status: "committed",
        commitId,
        headBefore,
        observedHead,
        historyState: "accepted",
        worktreeState: "restored",
      };
    } catch (error) {
      observedHead = this.getHeadCommitId();
      const historyMayHaveBeenAccepted =
        commitAttempted && (historyAccepted || observedHead !== headBefore);
      if (historyMayHaveBeenAccepted) {
        outcome = {
          status: "indeterminate",
          phase: "commit",
          headBefore,
          observedHead,
          ...(candidateCommitId ? { candidateCommitId } : {}),
          historyState: this.classifyCommitInvocationHistory(
            observedHead,
            candidateCommitId,
            historyAccepted,
          ),
          worktreeState: "restored",
          diagnostics: freezeDiagnostics([
            diagnosticFromError(error, "repository-commit-snapshot-commit-failed"),
          ]),
        };
      } else {
        const phase = stageCompleted ? "pre-commit" : "stage";
        outcome = {
          status: "failed",
          phase,
          headBefore,
          observedHead,
          historyState: "not-started",
          worktreeState: "unknown",
          diagnostics: freezeDiagnostics([
            diagnosticFromError(
              error,
              phase === "stage"
                ? "repository-commit-snapshot-stage-failed"
                : "repository-commit-snapshot-pre-commit-failed",
            ),
          ]),
        };
      }
    }

    const restoreDiagnostics = this.restoreCommitSnapshotState(
      publicWorktree,
      publicWorktreeMayNeedRestore,
      workspaceBackup,
    );
    const finalObservedHead = this.getHeadCommitId();
    if (restoreDiagnostics.length > 0) {
      return {
        status: "indeterminate",
        phase: "restore",
        headBefore,
        observedHead: finalObservedHead,
        ...(candidateCommitId ? { candidateCommitId } : {}),
        historyState: this.historyStateAfterRestoreFailure(outcome),
        worktreeState: "unknown",
        diagnostics: freezeDiagnostics([
          ...("diagnostics" in outcome ? outcome.diagnostics : []),
          ...restoreDiagnostics,
        ]),
      };
    }

    if (outcome.status === "failed") {
      return {
        ...outcome,
        observedHead: finalObservedHead,
        worktreeState: "restored",
      };
    }
    if (outcome.status === "indeterminate") {
      return {
        ...outcome,
        observedHead: finalObservedHead,
        worktreeState: "restored",
      };
    }
    return {
      ...outcome,
      observedHead: finalObservedHead,
      worktreeState: "restored",
    };
  }

  private captureWorkspaceState(): WorkspaceBackup {
    if (!this.backend?.readWorkspaceState || !this.backend.writeWorkspaceState) {
      return { kind: "unavailable" };
    }
    const state = this.backend.readWorkspaceState();
    return {
      kind: "captured",
      state: state ? cloneWorkspaceState(state) : null,
    };
  }

  private restoreCommitSnapshotState(
    publicWorktree: DataElementNode | undefined,
    publicWorktreeMayNeedRestore: boolean,
    workspaceBackup: WorkspaceBackup,
  ): readonly RevisionedPersistenceDiagnostic[] {
    const diagnostics: RevisionedPersistenceDiagnostic[] = [];
    if (publicWorktreeMayNeedRestore && publicWorktree) {
      try {
        this.vfs.loadSnapshot(publicWorktree);
      } catch (error) {
        diagnostics.push(
          diagnosticFromError(error, "repository-commit-snapshot-worktree-restore-failed"),
        );
      }
    }

    if (workspaceBackup.kind === "captured" && workspaceBackup.state) {
      try {
        this.backend?.writeWorkspaceState?.(cloneWorkspaceState(workspaceBackup.state));
      } catch (error) {
        diagnostics.push(
          diagnosticFromError(error, "repository-commit-snapshot-workspace-restore-failed"),
        );
      }
    }

    return freezeDiagnostics(diagnostics);
  }

  private classifyCommitInvocationHistory(
    observedHead: ObjectId | null,
    candidateCommitId?: ObjectId,
    historyAccepted = false,
  ): "possibly-accepted" | "accepted" {
    if (historyAccepted || (candidateCommitId && observedHead === candidateCommitId)) {
      return "accepted";
    }
    return "possibly-accepted";
  }

  private historyStateAfterRestoreFailure(
    outcome: PendingCommitSnapshotOutcome,
  ): CommitSnapshotHistoryState {
    if (outcome.status === "committed") {
      return "accepted";
    }
    if (outcome.status === "indeterminate" && outcome.phase === "commit") {
      return outcome.historyState;
    }
    return "not-started";
  }

  private commitTree(
    tree: ObjectId,
    message: string,
    options: { author?: string } = {},
    commitOptions: {
      readonly persistWorkspace: boolean;
      readonly onCandidateCommitId?: (commitId: ObjectId) => void;
      readonly onHistoryAccepted?: () => void;
    },
  ): ObjectId {
    if (this.head.type !== "branch") {
      throw new VcsError("EDETACHEDHEAD", "Cannot commit while HEAD is detached");
    }

    const author = options.author ?? "system";
    const currentCommit = this.getHeadCommitId();
    const timestamp = new Date().toISOString();
    const commit: CommitObject = {
      type: "commit",
      tree,
      parents: currentCommit ? [currentCommit] : [],
      author,
      message,
      timestamp,
    };

    const commitId = this.store.put(commit);
    commitOptions.onCandidateCommitId?.(commitId);
    const oldCommitId = this.branches.get(this.head.name) ?? null;
    this.branches.set(this.head.name, commitId);
    commitOptions.onHistoryAccepted?.();

    if (this.backend) {
      this.backend.updateBranchHead({
        branchName: this.head.name,
        oldCommitId,
        newCommitId: commitId,
        author,
        message,
        timestamp,
      });
    }
    if (commitOptions.persistWorkspace) {
      this.persistWorkspace();
    }
    return commitId;
  }

  checkout(ref: string, options: { force?: boolean } = {}): void {
    const dirty = this.status();
    if (!options.force && !dirty.clean) {
      throw new VcsError("EDIRTYWORKTREE", "Cannot checkout with dirty working tree");
    }

    if (this.branches.has(ref)) {
      this.head = { type: "branch", name: ref };
      const commitId = this.branches.get(ref) ?? null;
      if (!commitId) {
        this.vfs.loadSnapshot(createFolderNode(VFS_PROJECT));
      } else {
        this.checkoutCommit(commitId);
      }
      this.persistWorkspace();
      return;
    }

    const commitId = this.resolveCommit(ref);
    assertVcs(Boolean(commitId), "ENOENT", `Unknown ref: ${ref}`);
    this.head = { type: "detached", commitId: commitId as ObjectId };
    this.checkoutCommit(commitId as ObjectId);
    this.persistWorkspace();
  }

  status(): RepositoryStatus {
    const diff = this.diffDetailed("HEAD", WORKTREE_REF).entries;

    return {
      added: diff.filter((entry) => entry.change === "added").map((entry) => entry.path),
      modified: diff.filter((entry) => entry.change === "modified").map((entry) => entry.path),
      deleted: diff.filter((entry) => entry.change === "deleted").map((entry) => entry.path),
      entries: diff,
      clean: diff.length === 0,
    };
  }

  createBranch(name: string, startPoint?: string): void {
    if (this.branches.has(name)) {
      throw new VcsError("EEXIST", `Branch exists: ${name}`);
    }
    const fromCommit = startPoint ? this.resolveCommit(startPoint) : this.getHeadCommitId();
    this.branches.set(name, fromCommit ?? null);
  }

  deleteBranch(name: string): void {
    if (!this.branches.has(name)) {
      throw new VcsError("ENOENT", `Branch not found: ${name}`);
    }
    if (this.head.type === "branch" && this.head.name === name) {
      throw new VcsError("EINVAL", `Cannot delete checked out branch: ${name}`);
    }
    this.branches.delete(name);
  }

  listBranches(): string[] {
    return [...this.branches.keys()].sort((a, b) => a.localeCompare(b));
  }

  createTag(name: string, target?: string, message?: string): ObjectId {
    if (this.tags.has(name)) {
      throw new VcsError("EEXIST", `Tag exists: ${name}`);
    }
    const commitId = target ? this.resolveCommit(target) : this.getHeadCommitId();
    assertVcs(Boolean(commitId), "ENOENT", `Unknown tag target: ${target ?? "HEAD"}`);

    const tag: TagObject = {
      type: "tag",
      target: commitId as ObjectId,
      name,
      message,
    };
    const tagId = this.store.put(tag);
    this.tags.set(name, tagId);
    return tagId;
  }

  listTags(): string[] {
    return [...this.tags.keys()].sort((a, b) => a.localeCompare(b));
  }

  findMergeBase(refA: string, refB: string): ObjectId | null {
    const a = this.resolveCommit(refA);
    const b = this.resolveCommit(refB);
    if (!a || !b) {
      return null;
    }

    const distA = this.computeDistances(a);
    const distB = this.computeDistances(b);

    let best: { id: ObjectId; score: number } | null = null;
    for (const [id, da] of distA.entries()) {
      const db = distB.get(id);
      if (db === undefined) continue;
      const score = Math.max(da, db);
      if (!best || score < best.score || (score === best.score && id < best.id)) {
        best = { id, score };
      }
    }

    return best?.id ?? null;
  }

  log(limit = 50, startRef = "HEAD"): LogEntry[] {
    const commitId = this.resolveCommit(startRef);
    if (!commitId) {
      return [];
    }

    const entries: LogEntry[] = [];
    let cursor: ObjectId | null = commitId;
    while (cursor && entries.length < limit) {
      const commit = this.getCommit(cursor);
      entries.push({
        id: cursor,
        message: commit.message,
        author: commit.author,
        timestamp: commit.timestamp,
        parents: commit.parents,
      });
      cursor = commit.parents[0] ?? null;
    }
    return entries;
  }

  diff(refA: string, refB: string = WORKTREE_REF): StatusEntry[] {
    return this.diffDetailed(refA, refB).entries;
  }

  diffDetailed(refA: string, refB: string = WORKTREE_REF): RepositoryDiffResult {
    const from = this.resolveSnapshot(refA);
    const to = this.resolveSnapshot(refB);
    const mutations = diffVfsSnapshots(from, to, this.mutationRuntimeOptions);
    const fromKinds = collectNodeKinds(from);
    const toKinds = collectNodeKinds(to);
    const entries = entriesFromMutations(mutations, fromKinds, toKinds);
    return {
      entries,
      mutations,
      fromSnapshot: JSON.parse(JSON.stringify(from)) as DataElementNode,
      toSnapshot: JSON.parse(JSON.stringify(to)) as DataElementNode,
    };
  }

  merge(sourceRef: string, options: { resolutions?: MergeResolution[] } = {}): MergeOutcome {
    const oursId = this.getHeadCommitId();
    const theirsId = this.resolveCommit(sourceRef);
    assertVcs(Boolean(theirsId), "ENOENT", `Unknown source ref for merge: ${sourceRef}`);

    if (!oursId) {
      if (this.head.type === "branch") {
        this.branches.set(this.head.name, theirsId as ObjectId);
      } else {
        this.head = { type: "detached", commitId: theirsId as ObjectId };
      }
      this.checkoutCommit(theirsId as ObjectId);
      this.persistWorkspace();
      return { kind: "fast_forward", commitId: theirsId as ObjectId };
    }

    if (oursId === theirsId) {
      return { kind: "already_up_to_date" };
    }

    if (this.isAncestor(theirsId as ObjectId, oursId)) {
      return { kind: "already_up_to_date" };
    }

    if (this.isAncestor(oursId, theirsId as ObjectId)) {
      if (this.head.type === "branch") {
        this.branches.set(this.head.name, theirsId as ObjectId);
      } else {
        this.head = { type: "detached", commitId: theirsId as ObjectId };
      }
      this.checkoutCommit(theirsId as ObjectId);
      this.persistWorkspace();
      return { kind: "fast_forward", commitId: theirsId as ObjectId };
    }

    const baseId = this.findMergeBase(oursId, theirsId as ObjectId);

    const oursSnapshot = readTreeSnapshot(this.getCommit(oursId).tree, this.store, this.contentStore);
    const theirsSnapshot = readTreeSnapshot(this.getCommit(theirsId as ObjectId).tree, this.store, this.contentStore);
    const baseSnapshot = baseId ? readTreeSnapshot(this.getCommit(baseId).tree, this.store, this.contentStore) : undefined;

    const baseFiles = baseSnapshot ? flattenSnapshot(baseSnapshot) : [];
    const oursFiles = flattenSnapshot(oursSnapshot);
    const theirsFiles = flattenSnapshot(theirsSnapshot);

    const folderMap = buildFolderMapPreference(collectFolders(oursSnapshot), baseSnapshot ? collectFolders(baseSnapshot) : new Map());

    const merged = this.mergeFileSnapshots(baseFiles, oursFiles, theirsFiles, options.resolutions ?? []);
    if (merged.conflicts.length > 0) {
      return {
        kind: "conflict",
        conflicts: merged.conflicts,
      };
    }

    this.resetWorkingTreeToFiles(merged.files, folderMap, collectFolders(oursSnapshot).get(VFS_ROOT)?.metadataId);
    const mergeMessage = `merge ${sourceRef}`;
    const tree = buildTree(this.vfs, this.store, this.contentStore);
    const commit: CommitObject = {
      type: "commit",
      tree,
      parents: uniqueSorted([oursId, theirsId as ObjectId]),
      author: "system",
      message: mergeMessage,
      timestamp: new Date().toISOString(),
    };
    const mergeCommitId = this.store.put(commit);

    if (this.head.type === "branch") {
      this.branches.set(this.head.name, mergeCommitId);
    } else {
      this.head = { type: "detached", commitId: mergeCommitId };
    }

    this.persistWorkspace();
    return {
      kind: "merged",
      commitId: mergeCommitId,
      conflicts: [],
    };
  }

  private resolveCommit(ref: string): ObjectId | null {
    if (ref === "HEAD") {
      return this.getHeadCommitId();
    }

    if (this.branches.has(ref)) {
      return this.branches.get(ref) ?? null;
    }

    if (this.tags.has(ref)) {
      const tagId = this.tags.get(ref) ?? null;
      if (!tagId) return null;
      const tag = assertObject(this.store.get<TagObject>(tagId), tagId);
      if (tag.type !== "tag") {
        throw new VcsError("EINVAL", `Object is not a tag: ${tagId}`);
      }
      return tag.target;
    }

    if (this.store.has(ref)) {
      const object = this.store.get(ref);
      if (object && object.type === "commit") {
        return ref;
      }
    }

    return null;
  }

  private resolveSnapshot(ref: string): DataElementNode {
    if (ref === WORKTREE_REF) {
      return this.vfs.getSnapshot();
    }

    if (ref === "HEAD") {
      const commitId = this.getHeadCommitId();
      if (!commitId) {
        return createFolderNode(VFS_PROJECT);
      }
      return readTreeSnapshot(this.getCommit(commitId).tree, this.store, this.contentStore);
    }

    if (this.branches.has(ref)) {
      const commitId = this.branches.get(ref) ?? null;
      if (!commitId) {
        return createFolderNode(VFS_PROJECT);
      }
      return readTreeSnapshot(this.getCommit(commitId).tree, this.store, this.contentStore);
    }

    const commitId = this.resolveCommit(ref);
    if (!commitId) {
      throw new VcsError("ENOENT", `Cannot diff unknown refs: ${ref}`);
    }
    return readTreeSnapshot(this.getCommit(commitId).tree, this.store, this.contentStore);
  }

  private getCommit(commitId: ObjectId): CommitObject {
    const object = assertObject(this.store.get(commitId), commitId);
    if (object.type !== "commit") {
      throw new VcsError("EINVAL", `Object is not a commit: ${commitId}`);
    }
    return object;
  }

  private checkoutCommit(commitId: ObjectId): void {
    const commit = this.getCommit(commitId);
    checkoutTree(commit.tree, this.vfs, this.store, this.contentStore);
  }

  private computeDistances(start: ObjectId): Map<ObjectId, number> {
    const distance = new Map<ObjectId, number>();
    const queue: Array<{ id: ObjectId; depth: number }> = [{ id: start, depth: 0 }];

    while (queue.length > 0) {
      const item = queue.shift() as { id: ObjectId; depth: number };
      const prev = distance.get(item.id);
      if (prev !== undefined && prev <= item.depth) {
        continue;
      }
      distance.set(item.id, item.depth);

      const commit = this.getCommit(item.id);
      for (const parent of commit.parents) {
        queue.push({ id: parent, depth: item.depth + 1 });
      }
    }

    return distance;
  }

  private isAncestor(ancestor: ObjectId, descendant: ObjectId): boolean {
    const queue: ObjectId[] = [descendant];
    const seen = new Set<ObjectId>();

    while (queue.length > 0) {
      const current = queue.shift() as ObjectId;
      if (current === ancestor) {
        return true;
      }
      if (seen.has(current)) continue;
      seen.add(current);
      const commit = this.getCommit(current);
      queue.push(...commit.parents);
    }
    return false;
  }

  private mergeFileSnapshots(
    baseFiles: FileSnapshot[],
    oursFiles: FileSnapshot[],
    theirsFiles: FileSnapshot[],
    resolutions: MergeResolution[]
  ): { files: FileSnapshot[]; conflicts: MergeConflict[] } {
    const baseById = buildIdMap(baseFiles);
    const oursById = buildIdMap(oursFiles);
    const theirsById = buildIdMap(theirsFiles);
    const resolutionById = new Map(resolutions.map((item) => [item.metadataId, item.choice]));

    const allIds = uniqueSorted([...baseById.keys(), ...oursById.keys(), ...theirsById.keys()]);
    const merged: FileSnapshot[] = [];
    const conflicts: MergeConflict[] = [];

    for (const id of allIds) {
      const base = baseById.get(id);
      const ours = oursById.get(id);
      const theirs = theirsById.get(id);

      const oursRenamed = Boolean(base && ours && base.path !== ours.path);
      const theirsRenamed = Boolean(base && theirs && base.path !== theirs.path);
      if (oursRenamed && theirsRenamed && ours && theirs && ours.path !== theirs.path) {
        const choice = resolutionById.get(id);
        if (!choice) {
          conflicts.push({
            type: "RENAME_RENAME",
            metadataId: id,
            basePath: base?.path,
            oursPath: ours.path,
            theirsPath: theirs.path,
          });
          continue;
        }
        if (choice === "ours") {
          merged.push(ours);
          continue;
        }
        if (choice === "theirs") {
          merged.push(theirs);
          continue;
        }
        if (base) {
          merged.push(base);
        }
        continue;
      }

      if (!ours && theirs && base && base.content !== theirs.content) {
        const choice = resolutionById.get(id);
        if (!choice) {
          conflicts.push({
            type: "DELETE_MODIFY",
            metadataId: id,
            basePath: base.path,
            theirsPath: theirs.path,
          });
          continue;
        }
        if (choice === "theirs") {
          merged.push(theirs);
        } else if (choice === "base") {
          merged.push(base);
        }
        continue;
      }

      if (ours && !theirs && base && base.content !== ours.content) {
        const choice = resolutionById.get(id);
        if (!choice) {
          conflicts.push({
            type: "DELETE_MODIFY",
            metadataId: id,
            basePath: base.path,
            oursPath: ours.path,
          });
          continue;
        }
        if (choice === "ours") {
          merged.push(ours);
        } else if (choice === "base") {
          merged.push(base);
        }
        continue;
      }

      if (ours && !theirs) {
        merged.push(ours);
        continue;
      }
      if (!ours && theirs) {
        merged.push(theirs);
        continue;
      }
      if (!ours || !theirs) {
        continue;
      }

      if (ours.content === theirs.content && ours.path === theirs.path) {
        merged.push(ours);
        continue;
      }

      const baseContent = base?.content ?? "";
      const fileType = ours.fileType ?? theirs.fileType;
      const mergedPath = ours.path;

      if (fileType === "xnl") {
        const result = mergeXnl(baseContent, ours.content, theirs.content);
        merged.push({ ...ours, path: mergedPath, content: result.merged });
        continue;
      }
      if (fileType === "binary") {
        const result = mergeBinary(baseContent, ours.content, theirs.content);
        if (result.conflict) {
          const choice = resolutionById.get(id);
          if (!choice) {
            conflicts.push({
              type: "BINARY_UNMERGEABLE",
              metadataId: id,
              basePath: base?.path,
              oursPath: ours.path,
              theirsPath: theirs.path,
            });
            continue;
          }
          if (choice === "ours") {
            merged.push(ours);
          } else if (choice === "theirs") {
            merged.push(theirs);
          } else if (base) {
            merged.push(base);
          }
          continue;
        }
        merged.push({ ...ours, path: mergedPath, content: result.merged ?? ours.content });
        continue;
      }

      const result = mergeText(baseContent, ours.content, theirs.content);
      if (result.conflict) {
        const choice = resolutionById.get(id);
        if (!choice) {
          conflicts.push({
            type: "DELETE_MODIFY",
            metadataId: id,
            basePath: base?.path,
            oursPath: ours.path,
            theirsPath: theirs.path,
            details: { reason: "text_conflict" },
          });
          continue;
        }
        if (choice === "ours") {
          merged.push(ours);
        } else if (choice === "theirs") {
          merged.push(theirs);
        } else if (base) {
          merged.push(base);
        }
        continue;
      }
      merged.push({ ...ours, path: mergedPath, content: result.merged });
    }

    merged.sort((a, b) => a.path.localeCompare(b.path));
    return { files: merged, conflicts };
  }

  private resetWorkingTreeToFiles(
    files: FileSnapshot[],
    folderMap: Map<string, { metadataId: string; extend?: unknown }>,
    rootId?: string
  ): void {
    const rebuilt = buildSnapshotFromFiles(files, folderMap, rootId);
    this.vfs.loadSnapshot(rebuilt.getSnapshot());
  }
}
