// xnl-vcs history binding (P4 / decision D2).
//
// Three-tier write cadence (D2):
//   apply   — every edit mutates the shared VirtualFileSystem immediately (store)
//   autosave— debounced persist of the working tree (store, via IndexedDbVfsPersistence)
//   commit  — explicit save() => one immutable xnl-vcs commit (here)
//
// The Repository shares the SAME VirtualFileSystem instance as the store, so a
// commit snapshots exactly the current working tree, and a checkout writes the
// chosen revision back into that shared tree.

import {
  Repository,
  IndexedDbRepositoryBackend,
  type LogEntry,
  type HeadState,
} from "xnl-vcs";
import type { VirtualFileSystem } from "xnl-vfs";

export interface XnlVcsHistoryOptions {
  vfs: VirtualFileSystem;
  /** One repo per tree. */
  treeId: string;
  dbName?: string;
  author?: string;
}

export interface XnlVcsHistory {
  /** Explicit save = one commit of the current working tree. Returns commit id. */
  save(message: string): string;
  /** Commit log (newest first). */
  history(limit?: number): LogEntry[];
  /** Restore a revision into the shared working tree. Caller refreshes after. */
  checkout(ref: string): void;
  /** Current HEAD commit id (null on an empty repo). */
  headCommitId(): string | null;
}

/**
 * Open (or reopen) a per-tree repository over the shared vfs. On reopen the
 * current branch head is restored so `history()` shows prior commits; the actual
 * working tree is owned by the store's vfs persistence (loaded after this), so we
 * deliberately do NOT call loadWorkspaceState() here (it would clobber uncommitted
 * edits with the last committed snapshot).
 */
export async function createXnlVcsHistory(options: XnlVcsHistoryOptions): Promise<XnlVcsHistory> {
  const { vfs, treeId } = options;
  const author = options.author ?? "vfs-editor";
  const backend = await IndexedDbRepositoryBackend.open({
    dbName: options.dbName ?? "xnl-vfs-editor-vcs",
    repoId: treeId,
  });

  const head: HeadState | null = backend.readHead ? backend.readHead() : null;

  let repo: Repository;
  if (head && head.type === "branch") {
    const target = backend.readRef ? backend.readRef(head.name) : null;
    repo = new Repository({
      vfs,
      backend,
      state: { head, branches: { [head.name]: target }, tags: {} },
    });
  } else if (head && head.type === "detached") {
    repo = new Repository({
      vfs,
      backend,
      state: { head, branches: { main: null }, tags: {} },
    });
  } else {
    repo = new Repository({ vfs, backend });
    repo.init("main");
  }

  return {
    save(message: string): string {
      return repo.commit(message, { author });
    },
    history(limit = 50): LogEntry[] {
      try {
        return repo.log(limit, "HEAD");
      } catch {
        return [];
      }
    },
    checkout(ref: string): void {
      repo.checkout(ref, { force: true });
    },
    headCommitId(): string | null {
      return repo.getHeadCommitId();
    },
  };
}
