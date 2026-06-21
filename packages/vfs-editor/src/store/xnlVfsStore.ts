// Reusable xnl-vfs / xnl-vcs data layer for the VfsEditor component (P3 + P4).
//
// Replaces the original app's bespoke vfsStore + db/indexedDb. xnl-vfs is the
// single file-system source of truth (R1); IndexedDB is only its persistence
// backend (not a competing source). The working tree autosaves (debounced);
// explicit save() creates an xnl-vcs commit (D2). xnl-vfs has no reactivity, so
// the store rebuilds `currentNodes` after every mutation.

import { ref, shallowRef } from "vue";
import { VirtualFileSystem, IndexedDbVfsPersistence } from "xnl-vfs";
import type { LogEntry } from "xnl-vcs";
import { createXnlVcsHistory, type XnlVcsHistory } from "./xnlVcsHistory";
import { flattenSnapshot, toVfsPath } from "./mapping";
import type { VfsNode, VfsTree } from "../types";

const RESERVED = [".node-meta", ".xnl-vcs"];
const REGISTRY_KEY = "xnl-vfs-editor:trees";

export interface XnlVfsStoreOptions {
  /** IndexedDB name for the vfs working trees. */
  dbName?: string;
  /** IndexedDB name for the vcs history. */
  vcsDbName?: string;
  /** Commit author. */
  author?: string;
  /** Debounce (ms) for working-tree autosave. */
  autosaveMs?: number;
}

interface TreeRuntime {
  vfs: VirtualFileSystem;
  persistence: IndexedDbVfsPersistence;
  history: XnlVcsHistory;
}

function nowIso(): string {
  return new Date().toISOString();
}

function genId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `tree_${nowIso()}_${Math.floor(Math.random() * 1e6)}`;
}

function readRegistry(): VfsTree[] {
  try {
    const raw = globalThis.localStorage?.getItem(REGISTRY_KEY);
    return raw ? (JSON.parse(raw) as VfsTree[]) : [];
  } catch {
    return [];
  }
}

function writeRegistry(trees: VfsTree[]): void {
  try {
    globalThis.localStorage?.setItem(REGISTRY_KEY, JSON.stringify(trees));
  } catch {
    /* non-fatal: registry persistence is best-effort */
  }
}

export function useXnlVfsStore(options: XnlVfsStoreOptions = {}) {
  const autosaveMs = options.autosaveMs ?? 500;

  const trees = ref<VfsTree[]>([]);
  const currentTreeId = ref<string | null>(null);
  const currentNodes = ref<VfsNode[]>([]);
  const selectedNode = shallowRef<VfsNode | null>(null);
  const loading = ref(false);
  const dirty = ref(false);

  const runtimes = new Map<string, TreeRuntime>();
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  function rt(): TreeRuntime | null {
    return currentTreeId.value ? runtimes.get(currentTreeId.value) ?? null : null;
  }

  function getNode(id: string): VfsNode | undefined {
    return currentNodes.value.find((n) => n.id === id);
  }

  function parentPathOf(parentId: string | null): string {
    if (!parentId) return "/";
    return getNode(parentId)?.path ?? "/";
  }

  function childPath(parentPath: string, name: string): string {
    return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
  }

  function refreshNodes(): void {
    const r = rt();
    currentNodes.value = r ? flattenSnapshot(r.vfs.getSnapshot(), currentTreeId.value as string) : [];
  }

  function scheduleAutosave(): void {
    const r = rt();
    if (!r) return;
    dirty.value = true;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void r.persistence.saveFromVfs(r.vfs).then(() => {
        dirty.value = false;
      });
    }, autosaveMs);
  }

  // -------- trees --------

  function loadTrees(): void {
    trees.value = readRegistry();
  }

  function createTree(params: { name: string; description?: string }): VfsTree {
    const tree: VfsTree = {
      id: genId(),
      name: params.name,
      description: params.description,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    trees.value = [...trees.value, tree];
    writeRegistry(trees.value);
    return tree;
  }

  function deleteTree(id: string): void {
    trees.value = trees.value.filter((t) => t.id !== id);
    writeRegistry(trees.value);
    runtimes.delete(id);
    if (currentTreeId.value === id) {
      currentTreeId.value = null;
      currentNodes.value = [];
      selectedNode.value = null;
    }
  }

  async function ensureRuntime(treeId: string): Promise<TreeRuntime> {
    const existing = runtimes.get(treeId);
    if (existing) return existing;
    const vfs = new VirtualFileSystem(undefined, { reservedNames: RESERVED });
    const persistence = new IndexedDbVfsPersistence({ workspaceId: treeId, dbName: options.dbName });
    const history = await createXnlVcsHistory({
      vfs,
      treeId,
      dbName: options.vcsDbName,
      author: options.author,
    });
    // The working tree (latest, incl. uncommitted autosaves) is the source of
    // truth and wins over any head checkout performed during history creation.
    await persistence.loadIntoVfs(vfs);
    const runtime: TreeRuntime = { vfs, persistence, history };
    runtimes.set(treeId, runtime);
    return runtime;
  }

  async function selectTree(treeId: string): Promise<void> {
    loading.value = true;
    try {
      await ensureRuntime(treeId);
      currentTreeId.value = treeId;
      selectedNode.value = null;
      refreshNodes();
    } finally {
      loading.value = false;
    }
  }

  // -------- node CRUD (single writer = xnl-vfs working tree) --------

  function createFolder(name: string, parentId: string | null = null): void {
    const r = rt();
    if (!r) return;
    r.vfs.mkdir(toVfsPath(childPath(parentPathOf(parentId), name)), { recursive: true });
    refreshNodes();
    scheduleAutosave();
  }

  function createFile(name: string, parentId: string | null = null, content = ""): void {
    const r = rt();
    if (!r) return;
    r.vfs.writeFile(toVfsPath(childPath(parentPathOf(parentId), name)), content, { fileType: "text" });
    refreshNodes();
    scheduleAutosave();
  }

  function renameNode(id: string, newName: string): void {
    const r = rt();
    const node = getNode(id);
    if (!r || !node) return;
    const dest = childPath(parentPathOf(node.parentId), newName);
    r.vfs.rename(toVfsPath(node.path), toVfsPath(dest));
    refreshNodes();
    scheduleAutosave();
  }

  function updateNodeContent(id: string, content: string): void {
    const r = rt();
    const node = getNode(id);
    if (!r || !node || node.type !== "file") return;
    r.vfs.writeFile(toVfsPath(node.path), content, { overwrite: true, fileType: "text" });
    refreshNodes();
    scheduleAutosave();
  }

  function deleteNode(id: string): void {
    const r = rt();
    const node = getNode(id);
    if (!r || !node) return;
    const vp = toVfsPath(node.path);
    if (node.type === "directory") r.vfs.rmdir(vp, { recursive: true });
    else r.vfs.unlink(vp);
    if (selectedNode.value?.id === id) selectedNode.value = null;
    refreshNodes();
    scheduleAutosave();
  }

  function moveNode(id: string, newParentId: string | null): void {
    const r = rt();
    const node = getNode(id);
    if (!r || !node) return;
    const dest = childPath(parentPathOf(newParentId), node.name);
    if (dest === node.path) return;
    r.vfs.rename(toVfsPath(node.path), toVfsPath(dest));
    refreshNodes();
    scheduleAutosave();
  }

  function selectNode(node: VfsNode | null): void {
    selectedNode.value = node;
  }

  // -------- history (xnl-vcs, D2) --------

  async function save(message: string): Promise<string | null> {
    const r = rt();
    if (!r) return null;
    const commitId = r.history.save(message);
    await r.persistence.saveFromVfs(r.vfs);
    dirty.value = false;
    return commitId;
  }

  function history(limit = 50): LogEntry[] {
    return rt()?.history.history(limit) ?? [];
  }

  async function checkout(ref: string): Promise<void> {
    const r = rt();
    if (!r) return;
    r.history.checkout(ref);
    await r.persistence.saveFromVfs(r.vfs);
    refreshNodes();
  }

  return {
    // state
    trees,
    currentTreeId,
    currentNodes,
    selectedNode,
    loading,
    dirty,
    // trees
    loadTrees,
    createTree,
    deleteTree,
    selectTree,
    // nodes
    refreshNodes,
    createFolder,
    createFile,
    renameNode,
    updateNodeContent,
    deleteNode,
    moveNode,
    selectNode,
    getNode,
    // history
    save,
    history,
    checkout,
  };
}

export type XnlVfsStore = ReturnType<typeof useXnlVfsStore>;
