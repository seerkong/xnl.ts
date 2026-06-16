import type { DataElementNode, XnlNode } from "xnl-core";
import { VfsError } from "./errors";
import { cloneNode, createFolderNode, folderChildren, readMetadataId, readName } from "./model";
import { VFS_PROJECT, VFS_ROOT } from "./path";
import { VirtualFileSystem } from "./vfs";

export interface IndexedDbVfsPersistenceOptions {
  workspaceId?: string;
  workspaceName?: string;
  dbName?: string;
  dbVersion?: number;
  indexedDbFactory?: IDBFactory;
}

type IndexedDbLoadResult = {
  snapshot: DataElementNode;
  warnings: string[];
  dirty: boolean;
};

type VfsNodeRecord = {
  workspaceId: string;
  metadataId: string;
  parentMetadataId: string | null;
  path: string;
  tag: "folder" | "file";
  order: number;
  metadata: Record<string, XnlNode>;
  attributes?: Record<string, XnlNode>;
  extend?: DataElementNode["extend"];
};

type VfsContentRecord = {
  metadataId: string;
  workspaceId: string;
  content: string;
};

type VfsWorkspaceRecord = {
  workspaceId: string;
  workspaceName: string;
  rootMetadataId: string;
  updatedAt: string;
};

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_DB_NAME = "xnl-vfs-db";
const DEFAULT_DB_VERSION = 1;
const SYSTEM_METADATA_KEYS = new Set(["id", "name", "refId"]);
const NODE_STORE = "vfs-nodes";
const CONTENT_STORE = "vfs-contents";
const WORKSPACE_STORE = "vfs-workspaces";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function splitChannels(node: DataElementNode): {
  metadata: Record<string, XnlNode>;
  attributes: Record<string, XnlNode>;
} {
  const metadataOut: Record<string, XnlNode> = {};
  const attributesOut: Record<string, XnlNode> = {};

  for (const [key, value] of Object.entries(node.metadata ?? {})) {
    if (SYSTEM_METADATA_KEYS.has(key)) {
      metadataOut[key] = cloneNode(value);
    } else {
      attributesOut[key] = cloneNode(value);
    }
  }

  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (SYSTEM_METADATA_KEYS.has(key)) {
      metadataOut[key] = cloneNode(value);
    } else {
      attributesOut[key] = cloneNode(value);
    }
  }

  return { metadata: metadataOut, attributes: attributesOut };
}

function createEmptyRoot(workspaceName: string): DataElementNode {
  return createFolderNode(workspaceName || VFS_PROJECT);
}

export class IndexedDbVfsPersistence {
  private readonly workspaceId: string;
  private readonly workspaceName: string;
  private readonly dbName: string;
  private readonly dbVersion: number;
  private readonly indexedDbFactory?: IDBFactory;

  constructor(options: IndexedDbVfsPersistenceOptions = {}) {
    this.workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
    this.workspaceName = options.workspaceName ?? VFS_PROJECT;
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.dbVersion = options.dbVersion ?? DEFAULT_DB_VERSION;
    this.indexedDbFactory = options.indexedDbFactory ?? (typeof globalThis !== "undefined" ? globalThis.indexedDB : undefined);
  }

  async loadSnapshot(): Promise<IndexedDbLoadResult> {
    const db = await this.openDb();
    try {
      const tx = db.transaction([WORKSPACE_STORE, NODE_STORE, CONTENT_STORE], "readonly");
      const workspaceStore = tx.objectStore(WORKSPACE_STORE);
      const nodeStore = tx.objectStore(NODE_STORE);
      const contentStore = tx.objectStore(CONTENT_STORE);

      const workspace = await requestToPromise<VfsWorkspaceRecord | undefined>(workspaceStore.get(this.workspaceId));
      if (!workspace) {
        await transactionDone(tx);
        return { snapshot: createEmptyRoot(this.workspaceName), warnings: [], dirty: false };
      }

      const nodeIndex = nodeStore.index("by-workspace");
      const nodes = await requestToPromise<VfsNodeRecord[]>(nodeIndex.getAll(IDBKeyRange.only(this.workspaceId)));

      const contentById = new Map<string, VfsContentRecord>();
      const allContents = await requestToPromise<VfsContentRecord[]>(contentStore.getAll());
      for (const record of allContents) {
        if (record.workspaceId === this.workspaceId) {
          contentById.set(record.metadataId, record);
        }
      }

      await transactionDone(tx);

      if (nodes.length === 0) {
        return { snapshot: createEmptyRoot(this.workspaceName), warnings: [], dirty: false };
      }

      const warnings: string[] = [];
      let dirty = false;
      const nodeById = new Map<string, DataElementNode>();
      const childrenByParent = new Map<string, Array<{ order: number; node: DataElementNode }>>();

      for (const record of nodes) {
        const metadata: Record<string, XnlNode> = {};
        const attributes: Record<string, XnlNode> = {};

        for (const [key, value] of Object.entries(record.metadata ?? {})) {
          if (SYSTEM_METADATA_KEYS.has(key)) {
            metadata[key] = cloneRecord(value);
          } else {
            attributes[key] = cloneRecord(value);
            warnings.push(`Node ${record.metadataId} has non-system metadata key: ${key}`);
            dirty = true;
          }
        }

        for (const [key, value] of Object.entries(record.attributes ?? {})) {
          if (SYSTEM_METADATA_KEYS.has(key)) {
            metadata[key] = cloneRecord(value);
            warnings.push(`Node ${record.metadataId} has system key in attributes: ${key}`);
            dirty = true;
          } else {
            attributes[key] = cloneRecord(value);
          }
        }

        const node: DataElementNode = {
          kind: "DataElement",
          tag: record.tag,
          metadata,
        };

        if (Object.keys(attributes).length > 0) {
          node.attributes = attributes;
        }
        if (record.extend) {
          node.extend = cloneRecord(record.extend);
        }
        if (record.tag === "folder") {
          node.body = [];
        }
        if (record.tag === "file") {
          node.attributes = {
            ...(node.attributes ?? {}),
            content: contentById.get(record.metadataId)?.content ?? "",
          };
        }

        nodeById.set(record.metadataId, node);

        if (record.parentMetadataId) {
          const children = childrenByParent.get(record.parentMetadataId) ?? [];
          children.push({ order: record.order, node });
          childrenByParent.set(record.parentMetadataId, children);
        }
      }

      const root = nodeById.get(workspace.rootMetadataId);
      if (!root || root.tag !== "folder") {
        const snapshot = createEmptyRoot(this.workspaceName);
        return {
          snapshot,
          warnings: [`Workspace ${this.workspaceId} missing root folder, creating default root`],
          dirty: true,
        };
      }

      for (const [parentId, children] of childrenByParent.entries()) {
        const parent = nodeById.get(parentId);
        if (!parent) {
          warnings.push(`Missing parent node ${parentId}`);
          dirty = true;
          continue;
        }
        if (parent.tag !== "folder") {
          warnings.push(`Parent node ${parentId} is not a folder`);
          dirty = true;
          continue;
        }
        parent.body = children.sort((a, b) => a.order - b.order).map((entry) => entry.node);
      }

      if (dirty) {
        await this.saveSnapshot(root);
      }

      return { snapshot: root, warnings, dirty };
    } finally {
      db.close();
    }
  }

  async saveSnapshot(snapshot: DataElementNode): Promise<void> {
    if (snapshot.tag !== "folder") {
      throw new VfsError("EINVAL", "VFS snapshot root must be a folder node");
    }

    const db = await this.openDb();
    try {
      const tx = db.transaction([WORKSPACE_STORE, NODE_STORE, CONTENT_STORE], "readwrite");
      const workspaceStore = tx.objectStore(WORKSPACE_STORE);
      const nodeStore = tx.objectStore(NODE_STORE);
      const contentStore = tx.objectStore(CONTENT_STORE);

      const nodeWorkspaceIndex = nodeStore.index("by-workspace");
      const nodeKeys = await requestToPromise<IDBValidKey[]>(nodeWorkspaceIndex.getAllKeys(IDBKeyRange.only(this.workspaceId)));
      for (const key of nodeKeys) {
        nodeStore.delete(key);
      }

      const allContentKeys = await requestToPromise<IDBValidKey[]>(contentStore.getAllKeys());
      for (const key of allContentKeys) {
        const existing = await requestToPromise<VfsContentRecord | undefined>(contentStore.get(key));
        if (existing?.workspaceId === this.workspaceId) {
          contentStore.delete(key);
        }
      }

      const walk = (
        node: DataElementNode,
        parentMetadataId: string | null,
        path: string,
        order: number,
      ): void => {
        if (node.tag !== "folder" && node.tag !== "file") {
          throw new VfsError("EINVAL", `Unsupported node tag in snapshot: <${node.tag}>`);
        }

        const split = splitChannels(node);
        const metadataId = typeof split.metadata.id === "string" ? split.metadata.id : readMetadataId(node);
        const nodeName = typeof split.metadata.name === "string" ? split.metadata.name : readName(node);
        split.metadata.id = metadataId;
        split.metadata.name = nodeName;

        const attributes = cloneRecord(split.attributes);
        const content = node.tag === "file" && typeof attributes.content === "string" ? attributes.content : "";
        if (node.tag === "file") {
          delete attributes.content;
        }

        const record: VfsNodeRecord = {
          workspaceId: this.workspaceId,
          metadataId,
          parentMetadataId,
          path,
          tag: node.tag,
          order,
          metadata: split.metadata,
          attributes,
        };

        if (node.extend) {
          record.extend = cloneRecord(node.extend);
        }

        nodeStore.put(record);

        if (node.tag === "file") {
          const contentRecord: VfsContentRecord = {
            metadataId,
            workspaceId: this.workspaceId,
            content,
          };
          contentStore.put(contentRecord);
        }

        if (node.tag === "folder") {
          const children = folderChildren(node);
          children.forEach((child, index) => {
            const childName = readName(child);
            const childPath = path === VFS_ROOT ? `${VFS_ROOT}${childName}` : `${path}/${childName}`;
            walk(child, metadataId, childPath, index);
          });
        }
      };

      walk(snapshot, null, VFS_ROOT, 0);

      const workspace: VfsWorkspaceRecord = {
        workspaceId: this.workspaceId,
        workspaceName: this.workspaceName,
        rootMetadataId: readMetadataId(snapshot),
        updatedAt: new Date().toISOString(),
      };
      workspaceStore.put(workspace);

      await transactionDone(tx);
    } finally {
      db.close();
    }
  }

  async saveFromVfs(vfs: VirtualFileSystem): Promise<void> {
    await this.saveSnapshot(vfs.getSnapshot());
  }

  async loadIntoVfs(vfs: VirtualFileSystem): Promise<IndexedDbLoadResult> {
    const result = await this.loadSnapshot();
    vfs.loadSnapshot(result.snapshot);
    return result;
  }

  private async openDb(): Promise<IDBDatabase> {
    const idb = this.indexedDbFactory;
    if (!idb) {
      throw new VfsError(
        "EINVAL",
        "IndexedDB is unavailable in this runtime. Pass indexedDbFactory to IndexedDbVfsPersistenceOptions in non-browser environments.",
      );
    }

    const request = idb.open(this.dbName, this.dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(NODE_STORE)) {
        const nodeStore = db.createObjectStore(NODE_STORE, { keyPath: "metadataId" });
        nodeStore.createIndex("by-parent", "parentMetadataId", { unique: false });
        nodeStore.createIndex("by-path", "path", { unique: false });
        nodeStore.createIndex("by-workspace", "workspaceId", { unique: false });
      }

      if (!db.objectStoreNames.contains(CONTENT_STORE)) {
        db.createObjectStore(CONTENT_STORE, { keyPath: "metadataId" });
      }

      if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
        db.createObjectStore(WORKSPACE_STORE, { keyPath: "workspaceId" });
      }
    };

    return requestToPromise(request);
  }
}
