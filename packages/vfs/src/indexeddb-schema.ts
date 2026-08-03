export const DEFAULT_XNL_VFS_DB_NAME = "xnl-vfs-db";
export const DEFAULT_XNL_VFS_DB_VERSION = 2;
export const VFS_NODE_STORE = "vfs-nodes";
export const VFS_CONTENT_STORE = "vfs-contents";
export const VFS_WORKSPACE_STORE = "vfs-workspaces";
export const REVISIONED_VFS_AUTHORITY_STORE = "revisioned-vfs-authorities";

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

export function upgradeXnlVfsDatabase(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(VFS_NODE_STORE)) {
    const nodeStore = database.createObjectStore(VFS_NODE_STORE, {
      keyPath: "metadataId",
    });
    nodeStore.createIndex("by-parent", "parentMetadataId", { unique: false });
    nodeStore.createIndex("by-path", "path", { unique: false });
    nodeStore.createIndex("by-workspace", "workspaceId", { unique: false });
  }

  if (!database.objectStoreNames.contains(VFS_CONTENT_STORE)) {
    database.createObjectStore(VFS_CONTENT_STORE, { keyPath: "metadataId" });
  }

  if (!database.objectStoreNames.contains(VFS_WORKSPACE_STORE)) {
    database.createObjectStore(VFS_WORKSPACE_STORE, { keyPath: "workspaceId" });
  }

  if (!database.objectStoreNames.contains(REVISIONED_VFS_AUTHORITY_STORE)) {
    database.createObjectStore(REVISIONED_VFS_AUTHORITY_STORE, {
      keyPath: "authorityId",
    });
  }
}

export function openXnlVfsDatabase(
  indexedDbFactory: IDBFactory,
  dbName: string,
  dbVersion: number,
): Promise<IDBDatabase> {
  const request = indexedDbFactory.open(dbName, dbVersion);
  request.onupgradeneeded = () => upgradeXnlVfsDatabase(request.result);
  return requestToPromise(request);
}
